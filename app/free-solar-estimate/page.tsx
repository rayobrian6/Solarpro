"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BatteryCharging,
  CheckCircle2,
  Clock,
  FileText,
  Home,
  Loader2,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Sun,
  User,
  Zap,
} from "lucide-react";

type SubmitState = "idle" | "submitting" | "success" | "error";
type BillUploadReceipt = {
  selected: boolean;
  server_received: boolean;
  storage_status: "stored" | "metadata_only_not_uploaded" | "not_provided" | string;
  filename: string | null;
  size_bytes: number | null;
  content_type: string | null;
  stored_for_admin_review: boolean;
  message: string;
};
type QualificationSubmitState =
  | "idle"
  | "submitting"
  | "success"
  | "error"
  | "skipped";

interface QualificationState {
  purchase_intent: string;
  estimated_credit_band: string;
  estimated_income_band: string;
  property_type: string;
  electrical_panel_size: string;
  sunlight_confidence: string;
  prior_quotes: string;
}

interface FormState {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  property_address: string;
  city: string;
  state: string;
  zip: string;
  utility_provider: string;
  average_monthly_bill: string;
  battery_interest: string;
  homeowner_status: string;
  preferred_contact_method: string;
  timeline: string;
  roof_age: string;
  optional_notes: string;
  consent_given: boolean;
}

const INITIAL_FORM: FormState = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  property_address: "",
  city: "",
  state: "",
  zip: "",
  utility_provider: "",
  average_monthly_bill: "",
  battery_interest: "",
  homeowner_status: "",
  preferred_contact_method: "phone",
  timeline: "",
  roof_age: "",
  optional_notes: "",
  consent_given: false,
};

const INITIAL_QUALIFICATION: QualificationState = {
  purchase_intent: "",
  estimated_credit_band: "",
  estimated_income_band: "",
  property_type: "",
  electrical_panel_size: "",
  sunlight_confidence: "",
  prior_quotes: "",
};

const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
];

const REQUIRED_FIELDS: Array<keyof FormState> = [
  "first_name",
  "last_name",
  "phone",
  "email",
  "property_address",
  "utility_provider",
  "average_monthly_bill",
  "battery_interest",
  "homeowner_status",
];

function fieldLabel(field: keyof FormState): string {
  return field
    .replace("property_address", "property address")
    .replace("average_monthly_bill", "average monthly bill")
    .replace("homeowner_status", "homeowner status")
    .replace("battery_interest", "battery interest")
    .replace("utility_provider", "utility provider")
    .replace(/_/g, " ");
}

function normalizeMoney(value: string): string {
  return value.replace(/[^0-9.]/g, "");
}

function buildOperationalNotes(form: FormState, billFile: File | null): string {
  const lines = [
    "Free solar estimate intake details:",
    `Property address entered: ${form.property_address.trim()}`,
    `Utility provider: ${form.utility_provider.trim()}`,
    `Battery interest: ${form.battery_interest}`,
    `Homeowner status: ${form.homeowner_status}`,
    `Preferred contact method: ${form.preferred_contact_method || "not provided"}`,
    `Timeline: ${form.timeline || "not provided"}`,
    `Roof age: ${form.roof_age || "not provided"}`,
  ];

  if (billFile) {
    lines.push(
      `Utility bill file selected: ${billFile.name} (${Math.round(billFile.size / 1024)} KB). The intake endpoint stores any non-empty utility bill file and links the attachment metadata to the canonical intake event.`,
    );
  }

  const homeownerNotes = form.optional_notes.trim();
  if (homeownerNotes) lines.push(`Homeowner notes: ${homeownerNotes}`);

  return lines.join("\n");
}

export default function FreeSolarEstimatePage() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState("");
  const [intakeReference, setIntakeReference] = useState<string | null>(null);
  const [billUploadReceipt, setBillUploadReceipt] = useState<BillUploadReceipt | null>(null);
  const [qualification, setQualification] = useState<QualificationState>(
    INITIAL_QUALIFICATION,
  );
  const [qualificationState, setQualificationState] =
    useState<QualificationSubmitState>("idle");
  const [qualificationError, setQualificationError] = useState("");

  const completedRequired = useMemo(() => {
    return REQUIRED_FIELDS.filter(
      (field) => String(form[field]).trim().length > 0,
    ).length;
  }, [form]);

  const updateField = (field: keyof FormState, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError("");
    if (submitState === "success") setSubmitState("idle");
  };

  const validate = (): string | null => {
    for (const field of REQUIRED_FIELDS) {
      if (!String(form[field]).trim())
        return `Please enter your ${fieldLabel(field)}.`;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return "Please enter a valid email address.";
    }

    const phoneDigits = form.phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) return "Please enter a valid phone number.";

    const bill = Number(normalizeMoney(form.average_monthly_bill));
    if (!Number.isFinite(bill) || bill <= 0)
      return "Please enter a realistic average monthly electric bill.";

    if (form.roof_age.trim()) {
      const roofAge = Number(form.roof_age);
      if (!Number.isFinite(roofAge) || roofAge < 0 || roofAge > 100)
        return "Please enter a valid roof age in years.";
    }

    if (!form.consent_given) {
      return "Please confirm that SolarPro may contact you about your solar estimate.";
    }

    return null;
  };

  const updateQualificationField = (
    field: keyof QualificationState,
    value: string,
  ) => {
    setQualification((prev) => ({ ...prev, [field]: value }));
    if (qualificationError) setQualificationError("");
  };

  const handleQualificationSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setQualificationError("");

    if (!intakeReference) {
      setQualificationError(
        "We could not find your intake reference. Your original request is still submitted, but qualification could not be linked.",
      );
      setQualificationState("error");
      return;
    }

    const requiredQualificationFields: Array<keyof QualificationState> = [
      "purchase_intent",
      "estimated_credit_band",
      "estimated_income_band",
      "property_type",
      "electrical_panel_size",
      "sunlight_confidence",
      "prior_quotes",
    ];

    const missing = requiredQualificationFields.find(
      (field) => !qualification[field],
    );
    if (missing) {
      setQualificationError(
        "Please answer each quick qualification question, or choose Skip for now.",
      );
      setQualificationState("error");
      return;
    }

    setQualificationState("submitting");

    try {
      const response = await fetch("/api/intake/homeowner/qualification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original_event_id: intakeReference,
          qualification,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) {
        setQualificationError(
          data.error ||
            "We could not save the qualification details. Your original request is still submitted.",
        );
        setQualificationState("error");
        return;
      }

      setQualificationState("success");
    } catch {
      setQualificationError(
        "Connection error while saving qualification details. Your original request is still submitted.",
      );
      setQualificationState("error");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitState("idle");
    setError("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setSubmitState("error");
      return;
    }

    const attributionParams =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();

    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim().toLowerCase(),
      address_line1: form.property_address.trim(),
      property_address: form.property_address.trim(),
      city: form.city.trim() || undefined,
      state: form.state || undefined,
      zip: form.zip.trim() || undefined,
      monthly_bill_amount: normalizeMoney(form.average_monthly_bill),
      average_monthly_bill: normalizeMoney(form.average_monthly_bill),
      utility_provider: form.utility_provider.trim(),
      battery_interest: form.battery_interest,
      homeowner_status: form.homeowner_status,
      home_ownership: form.homeowner_status,
      preferred_contact_method: form.preferred_contact_method || undefined,
      timeline: form.timeline || undefined,
      roof_age: form.roof_age.trim() || undefined,
      roof_age_years: form.roof_age.trim() || undefined,
      uploaded_bill_filename: billFile?.name || undefined,
      uploaded_bill_size_bytes: billFile?.size || undefined,
      uploaded_bill_content_type: billFile?.type || undefined,
      source_channel: "web",
      funnel_slug: "free-solar-estimate",
      utm_source: attributionParams.get("utm_source") || undefined,
      utm_medium: attributionParams.get("utm_medium") || undefined,
      utm_campaign: attributionParams.get("utm_campaign") || undefined,
      utm_content: attributionParams.get("utm_content") || undefined,
      utm_term: attributionParams.get("utm_term") || undefined,
      gclid: attributionParams.get("gclid") || undefined,
      fbclid: attributionParams.get("fbclid") || undefined,
      consent_given: form.consent_given,
      consent_text:
        "Homeowner consented to be contacted by SolarPro about a free solar estimate.",
      consent_timestamp: new Date().toISOString(),
      notes: buildOperationalNotes(form, billFile),
    };

    setBillUploadReceipt(null);
    setSubmitState("submitting");

    try {
      const requestBody = new FormData();
      requestBody.append("payload", JSON.stringify(payload));
      if (billFile) requestBody.append("utility_bill", billFile);

      const response = await fetch("/api/intake/homeowner", {
        method: "POST",
        body: requestBody,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.error) {
        setError(
          data.error ||
            "We could not submit your estimate request. Please try again.",
        );
        setSubmitState("error");
        return;
      }

      setIntakeReference(
        typeof data.event_id === "string" ? data.event_id : null,
      );
      setBillUploadReceipt(
        data.utility_bill_upload && typeof data.utility_bill_upload === "object"
          ? (data.utility_bill_upload as BillUploadReceipt)
          : null,
      );
      setSubmitState("success");
    } catch {
      setError(
        "Connection error. Please check your internet connection and try again.",
      );
      setSubmitState("error");
    }
  };

  if (submitState === "success") {
    return (
      <main className="min-h-screen bg-[#07070e] text-white px-5 py-10 sm:py-16">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.04] p-8 shadow-2xl shadow-emerald-950/30">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10">
              <CheckCircle2 className="h-8 w-8 text-emerald-300" />
            </div>
            <p className="mb-3 text-xs font-black uppercase tracking-[0.25em] text-emerald-300/80">
              Request received
            </p>
            <h1 className="mb-4 text-3xl font-black">
              Your free solar estimate is in motion.
            </h1>
            <p className="text-sm leading-6 text-slate-300">
              Thanks, {form.first_name.trim() || "there"}. Your information was
              submitted through SolarPro’s canonical homeowner intake event
              flow. A solar advisor will review the details and follow up
              shortly.
            </p>
            {intakeReference && (
              <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-slate-400">
                Internal intake event reference:{" "}
                <span className="font-mono text-slate-200">
                  {intakeReference}
                </span>
              </p>
            )}
            {billUploadReceipt?.server_received && (
              <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-sm leading-6 text-emerald-100">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-300" />
                  <div>
                    <p className="font-bold text-emerald-50">
                      Utility bill file received by SolarPro
                    </p>
                    <p className="mt-1 text-emerald-100/85">
                      {billUploadReceipt.message}
                    </p>
                    <p className="mt-2 text-xs text-emerald-100/70">
                      Received bytes: {billUploadReceipt.filename || "utility bill"}
                      {typeof billUploadReceipt.size_bytes === "number"
                        ? ` · ${Math.max(1, Math.round(billUploadReceipt.size_bytes / 1024))} KB`
                        : ""}
                      {billUploadReceipt.content_type
                        ? ` · ${billUploadReceipt.content_type}`
                        : ""}
                    </p>
                    <p className="mt-2 text-xs font-semibold text-emerald-100/80">
                      {billUploadReceipt.stored_for_admin_review
                        ? "Stored and linked for Admin Intake Feed review."
                        : "The server received the file, but durable storage did not return a retrievable admin link."}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {billUploadReceipt && !billUploadReceipt.server_received && billUploadReceipt.selected && (
              <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm leading-6 text-amber-100">
                <p className="font-bold">Utility bill was selected but not received by the server.</p>
                <p className="mt-1 text-amber-100/80">{billUploadReceipt.message}</p>
              </div>
            )}
            <div className="mt-8 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-200">
                Optional next step
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Answer seven quick questions so SolarPro can better understand
                financing preferences, battery readiness, shade risk, and
                property fit before review. This does not change your original
                request.
              </p>
            </div>
            <a
              href="/"
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-amber-300"
            >
              Back to SolarPro <ArrowRight className="h-4 w-4" />
            </a>
          </section>

          <section className="rounded-3xl border border-white/[0.08] bg-white/[0.035] p-5 shadow-2xl shadow-black/30 sm:p-8">
            {qualificationState === "success" ? (
              <div>
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10">
                  <CheckCircle2 className="h-7 w-7 text-emerald-300" />
                </div>
                <p className="mb-3 text-xs font-black uppercase tracking-[0.25em] text-emerald-300/80">
                  Qualification saved
                </p>
                <h2 className="mb-4 text-2xl font-black">
                  Your opportunity profile is now more complete.
                </h2>
                <p className="text-sm leading-6 text-slate-300">
                  These details were added as a second-stage qualification event
                  for SolarPro review.
                </p>
                <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 text-sm leading-6 text-emerald-100">
                  Thanks — your additional details were saved for SolarPro
                  review. A solar advisor will use them to prepare a more
                  accurate follow-up.
                </div>
              </div>
            ) : qualificationState === "skipped" ? (
              <div>
                <p className="mb-3 text-xs font-black uppercase tracking-[0.25em] text-slate-400">
                  Qualification skipped
                </p>
                <h2 className="mb-4 text-2xl font-black">
                  No problem — your estimate request is still submitted.
                </h2>
                <p className="text-sm leading-6 text-slate-300">
                  SolarPro can still review your original intake. You can
                  provide additional qualification details later with an
                  advisor.
                </p>
              </div>
            ) : (
              <form onSubmit={handleQualificationSubmit} className="space-y-5">
                <div>
                  <p className="mb-3 text-xs font-black uppercase tracking-[0.25em] text-amber-300/80">
                    Quick qualification
                  </p>
                  <h2 className="text-2xl font-black">
                    Help us qualify your solar opportunity.
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    These optional post-submit answers help SolarPro understand
                    financing readiness, property fit, battery readiness, and
                    contractor matching.
                  </p>
                </div>

                {qualificationError && (
                  <div className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{qualificationError}</span>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Purchase intent"
                    required
                    value={qualification.purchase_intent}
                    onChange={(value) =>
                      updateQualificationField("purchase_intent", value)
                    }
                    options={[
                      ["", "Select one"],
                      ["financing", "Financing"],
                      ["cash", "Cash buyer"],
                      ["not_sure", "Not sure yet"],
                    ]}
                  />
                  <SelectField
                    label="Estimated credit band"
                    required
                    value={qualification.estimated_credit_band}
                    onChange={(value) =>
                      updateQualificationField("estimated_credit_band", value)
                    }
                    options={[
                      ["", "Select one"],
                      ["720_plus", "720+"],
                      ["680_719", "680–719"],
                      ["640_679", "640–679"],
                      ["below_640", "Below 640"],
                      ["unsure", "Unsure"],
                    ]}
                  />
                  <SelectField
                    label="Estimated income band"
                    required
                    value={qualification.estimated_income_band}
                    onChange={(value) =>
                      updateQualificationField("estimated_income_band", value)
                    }
                    options={[
                      ["", "Select one"],
                      ["under_50k", "Under $50k"],
                      ["50k_100k", "$50k–$100k"],
                      ["100k_150k", "$100k–$150k"],
                      ["150k_plus", "$150k+"],
                      ["prefer_not_to_say", "Prefer not to say"],
                    ]}
                  />
                  <SelectField
                    label="Property type"
                    required
                    value={qualification.property_type}
                    onChange={(value) =>
                      updateQualificationField("property_type", value)
                    }
                    options={[
                      ["", "Select one"],
                      ["single_family", "Single-family home"],
                      ["farm", "Farm / rural property"],
                      ["mobile_home", "Mobile home"],
                      ["duplex", "Duplex"],
                      ["commercial", "Commercial property"],
                    ]}
                  />
                  <SelectField
                    label="Electrical panel size"
                    required
                    value={qualification.electrical_panel_size}
                    onChange={(value) =>
                      updateQualificationField("electrical_panel_size", value)
                    }
                    options={[
                      ["", "Select one"],
                      ["100a", "100A"],
                      ["150a", "150A"],
                      ["200a_plus", "200A+"],
                      ["unsure", "Unsure"],
                    ]}
                  />
                  <SelectField
                    label="Sunlight confidence"
                    required
                    value={qualification.sunlight_confidence}
                    onChange={(value) =>
                      updateQualificationField("sunlight_confidence", value)
                    }
                    options={[
                      ["", "Select one"],
                      ["full_sun", "Full sun"],
                      ["partial_shade", "Partial shade"],
                      ["heavy_shade", "Heavy shade"],
                      ["unsure", "Unsure"],
                    ]}
                  />
                  <SelectField
                    label="Prior solar quotes"
                    required
                    value={qualification.prior_quotes}
                    onChange={(value) =>
                      updateQualificationField("prior_quotes", value)
                    }
                    options={[
                      ["", "Select one"],
                      ["yes", "Yes"],
                      ["no", "No"],
                    ]}
                  />
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="submit"
                    disabled={qualificationState === "submitting"}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-amber-300 px-5 py-4 text-sm font-black text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {qualificationState === "submitting" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Saving
                        qualification...
                      </>
                    ) : (
                      <>
                        Save qualification details{" "}
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQualificationState("skipped")}
                    disabled={qualificationState === "submitting"}
                    className="rounded-2xl border border-white/[0.09] px-5 py-4 text-sm font-bold text-slate-300 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Skip for now
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#07070e] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-180px] h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-amber-400/[0.05] blur-[130px]" />
        <div className="absolute bottom-[-180px] right-[-140px] h-[440px] w-[440px] rounded-full bg-blue-500/[0.04] blur-[120px]" />
      </div>

      <header className="relative z-10 border-b border-white/[0.06] bg-[#07070e]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <a href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/10">
              <Sun className="h-4 w-4 text-amber-300" />
            </span>
            <span className="text-sm font-black tracking-tight">SolarPro</span>
          </a>
          <p className="hidden text-xs text-slate-500 sm:block">
            Canonical homeowner intake
          </p>
        </div>
      </header>

      <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:py-16">
        <section className="lg:pt-8">
          <p className="mb-4 text-xs font-black uppercase tracking-[0.28em] text-amber-300/70">
            Free Solar Estimate
          </p>
          <h1 className="mb-5 text-4xl font-black leading-tight sm:text-5xl">
            Get a realistic solar estimate for your home.
          </h1>
          <p className="mb-8 max-w-xl text-base leading-7 text-slate-400">
            Share your utility, bill, homeowner, battery, roof, and timeline
            details. This form submits directly into SolarPro’s canonical intake
            event log for operator review before any marketplace opportunity is
            created.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {[
              {
                icon: Zap,
                title: "Utility-aware estimate",
                text: "Your provider and bill help route the lead into the existing enrichment flow.",
              },
              {
                icon: BatteryCharging,
                title: "Battery readiness signal",
                text: "Battery interest is captured for downstream opportunity intelligence review.",
              },
              {
                icon: ShieldCheck,
                title: "No duplicate intake path",
                text: "The form posts only to /api/intake/homeowner and does not insert marketplace rows directly.",
              },
            ].map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"
              >
                <Icon className="mb-3 h-5 w-5 text-amber-300" />
                <h2 className="mb-1 text-sm font-bold text-white">{title}</h2>
                <p className="text-xs leading-5 text-slate-500">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/[0.08] bg-white/[0.035] p-5 shadow-2xl shadow-black/30 sm:p-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">Homeowner details</h2>
              <p className="mt-1 text-xs text-slate-500">
                Required fields completed: {completedRequired}/
                {REQUIRED_FIELDS.length}
              </p>
            </div>
            <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-amber-300 transition-all"
                style={{
                  width: `${(completedRequired / REQUIRED_FIELDS.length) * 100}%`,
                }}
              />
            </div>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                icon={User}
                label="First name"
                required
                value={form.first_name}
                onChange={(value) => updateField("first_name", value)}
              />
              <TextField
                icon={User}
                label="Last name"
                required
                value={form.last_name}
                onChange={(value) => updateField("last_name", value)}
              />
              <TextField
                icon={Phone}
                label="Phone"
                required
                inputMode="tel"
                value={form.phone}
                onChange={(value) => updateField("phone", value)}
                placeholder="(555) 123-4567"
              />
              <TextField
                icon={Mail}
                label="Email"
                required
                inputMode="email"
                value={form.email}
                onChange={(value) => updateField("email", value)}
                placeholder="you@example.com"
              />
            </div>

            <div className="grid gap-4">
              <TextField
                icon={MapPin}
                label="Property address"
                required
                value={form.property_address}
                onChange={(value) => updateField("property_address", value)}
                placeholder="123 Main St"
              />
              <div className="grid gap-4 sm:grid-cols-[1fr_120px_140px]">
                <TextField
                  icon={Home}
                  label="City"
                  value={form.city}
                  onChange={(value) => updateField("city", value)}
                />
                <SelectField
                  label="State"
                  value={form.state}
                  onChange={(value) => updateField("state", value)}
                  options={[
                    ["", "State"],
                    ...US_STATES.map(
                      (state) => [state, state] as [string, string],
                    ),
                  ]}
                />
                <TextField
                  label="ZIP"
                  value={form.zip}
                  onChange={(value) => updateField("zip", value)}
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                icon={Zap}
                label="Utility provider"
                required
                value={form.utility_provider}
                onChange={(value) => updateField("utility_provider", value)}
                placeholder="PG&E, SCE, APS..."
              />
              <TextField
                label="Average monthly electric bill"
                required
                value={form.average_monthly_bill}
                onChange={(value) => updateField("average_monthly_bill", value)}
                placeholder="$225"
                inputMode="decimal"
              />
              <SelectField
                label="Battery interest"
                required
                value={form.battery_interest}
                onChange={(value) => updateField("battery_interest", value)}
                options={[
                  ["", "Select one"],
                  ["yes", "Yes — I want backup power"],
                  ["maybe", "Maybe / depends on savings"],
                  ["no", "No battery for now"],
                ]}
              />
              <SelectField
                label="Homeowner status"
                required
                value={form.homeowner_status}
                onChange={(value) => updateField("homeowner_status", value)}
                options={[
                  ["", "Select one"],
                  ["own", "I own the home"],
                  ["co_owner", "I co-own the home"],
                  ["rent", "I rent / not the owner"],
                ]}
              />
              <SelectField
                label="Preferred contact"
                value={form.preferred_contact_method}
                onChange={(value) =>
                  updateField("preferred_contact_method", value)
                }
                options={[
                  ["phone", "Phone"],
                  ["text", "Text message"],
                  ["email", "Email"],
                ]}
              />
              <SelectField
                label="Timeline"
                value={form.timeline}
                onChange={(value) => updateField("timeline", value)}
                options={[
                  ["", "Select timeline"],
                  ["asap", "As soon as possible"],
                  ["1_3_months", "1–3 months"],
                  ["3_6_months", "3–6 months"],
                  ["researching", "Just researching"],
                ]}
              />
              <TextField
                icon={Clock}
                label="Roof age in years"
                value={form.roof_age}
                onChange={(value) => updateField("roof_age", value)}
                inputMode="numeric"
                placeholder="8"
              />
              <FileField file={billFile} isUploading={submitState === "submitting" && !!billFile} onChange={setBillFile} />
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                Optional notes
              </label>
              <textarea
                value={form.optional_notes}
                onChange={(event) =>
                  updateField("optional_notes", event.target.value)
                }
                placeholder="Tell us about your roof, EV plans, backup-power needs, or any HOA/utility concerns."
                className="min-h-[110px] w-full rounded-2xl border border-white/[0.09] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none transition focus:border-amber-300/50 focus:bg-white/[0.06]"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.consent_given}
                onChange={(event) =>
                  updateField("consent_given", event.target.checked)
                }
                className="mt-1 h-4 w-4 rounded border-white/20 bg-white/10 text-amber-300"
              />
              <span>
                I agree that SolarPro may contact me about my free solar
                estimate using the contact information I provided.
              </span>
            </label>

            <button
              type="submit"
              disabled={submitState === "submitting"}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-5 py-4 text-sm font-black text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitState === "submitting" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {billFile
                    ? "Uploading estimate + utility bill bytes..."
                    : "Submitting to intake pipeline..."}
                </>
              ) : (
                <>
                  Get my free solar estimate <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon?: React.ComponentType<{ className?: string }>;
  required?: boolean;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}

function TextField({
  label,
  value,
  onChange,
  icon: Icon,
  required,
  placeholder,
  inputMode,
}: TextFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
        {label} {required && <span className="text-red-300">*</span>}
      </span>
      <span className="relative block">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
        )}
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          className={`w-full rounded-2xl border border-white/[0.09] bg-white/[0.04] py-3 text-sm text-white placeholder:text-slate-600 outline-none transition focus:border-amber-300/50 focus:bg-white/[0.06] ${Icon ? "pl-10 pr-4" : "px-4"}`}
        />
      </span>
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  required?: boolean;
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required,
}: SelectFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
        {label} {required && <span className="text-red-300">*</span>}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/[0.09] bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/50 focus:bg-white/[0.06]"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option
            key={`${label}-${optionValue}`}
            value={optionValue}
            className="bg-slate-950 text-white"
          >
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function FileField({
  file,
  isUploading,
  onChange,
}: {
  file: File | null;
  isUploading: boolean;
  onChange: (file: File | null) => void;
}) {
  return (
    <div className="block">
      <label>
        <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
          Utility bill upload
        </span>
        <span className="flex min-h-[46px] cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-white/[0.13] bg-white/[0.025] px-4 py-3 text-sm text-slate-400 transition hover:border-amber-300/30 hover:bg-white/[0.04]">
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
          ) : (
            <FileText className="h-4 w-4 text-slate-500" />
          )}
          <span className="truncate">
            {file
              ? file.name
              : "Optional — upload any utility bill file for review"}
          </span>
          <input
            type="file"
            className="sr-only"
            disabled={isUploading}
            onChange={(event) => onChange(event.target.files?.[0] || null)}
          />
        </span>
      </label>
      {file && (
        <div className="mt-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-xs leading-5 text-slate-400">
          {isUploading ? (
            <span className="font-semibold text-amber-200">
              Uploading this file with your request now — sending actual file bytes to SolarPro intake.
            </span>
          ) : (
            <span>
              File selected locally, not uploaded yet. It will be sent when you submit the estimate request.
            </span>
          )}
          <span className="block text-slate-500">
            {Math.max(1, Math.round(file.size / 1024))} KB
            {file.type ? ` · ${file.type}` : " · browser did not report a file type"}
          </span>
        </div>
      )}
    </div>
  );
}
