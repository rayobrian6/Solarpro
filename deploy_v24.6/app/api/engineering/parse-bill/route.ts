import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

// ─── Bill Parse Result ────────────────────────────────────────────────────────
interface BillParseResult {
  annualKwh: number | null;
  monthlyKwh: number | null;
  electricityRate: number | null;
  utilityName: string | null;
  stateCode: string | null;
  accountNumber: string | null;
  serviceAddress: string | null;
  confidence: 'high' | 'medium' | 'low';
  rawText?: string;
}

// ─── Regex-based text extraction ─────────────────────────────────────────────
function extractFromText(text: string): BillParseResult {
  const t = text.toLowerCase();
  const result: BillParseResult = {
    annualKwh: null,
    monthlyKwh: null,
    electricityRate: null,
    utilityName: null,
    stateCode: null,
    accountNumber: null,
    serviceAddress: null,
    confidence: 'low',
  };

  // ── kWh usage ──────────────────────────────────────────────────────────────
  // Patterns: "1,234 kWh", "1234 kwh", "usage: 1234", "total usage 1,234 kwh"
  const kwhPatterns = [
    /total\s+(?:energy\s+)?(?:usage|used|consumption)[:\s]+([0-9,]+)\s*kwh/i,
    /(?:energy|electricity)\s+(?:usage|used|consumption)[:\s]+([0-9,]+)\s*kwh/i,
    /([0-9,]+)\s*kwh\s+(?:used|usage|consumed|billed)/i,
    /current\s+(?:month\s+)?(?:usage|charges?)[:\s]+([0-9,]+)\s*kwh/i,
    /kwh\s+(?:used|usage)[:\s]+([0-9,]+)/i,
    /([0-9,]+)\s*kwh/i,  // fallback: first kWh number
  ];

  for (const pattern of kwhPatterns) {
    const m = text.match(pattern);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 50 && val < 50000) {  // sanity check: 50–50,000 kWh/month
        result.monthlyKwh = Math.round(val);
        result.annualKwh = Math.round(val * 12);
        break;
      }
    }
  }

  // ── Electricity rate ───────────────────────────────────────────────────────
  // Patterns: "$0.1234/kWh", "0.1234 per kwh", "rate: $0.12"
  const ratePatterns = [
    /\$?\s*([0-9]+\.[0-9]{2,4})\s*(?:\/|per)\s*kwh/i,
    /(?:energy|electricity|rate)[:\s]+\$?\s*([0-9]+\.[0-9]{2,4})/i,
    /(?:unit\s+)?(?:price|rate|charge)[:\s]+\$?\s*([0-9]+\.[0-9]{2,4})\s*(?:\/kwh)?/i,
  ];

  for (const pattern of ratePatterns) {
    const m = text.match(pattern);
    if (m) {
      const val = parseFloat(m[1]);
      if (val > 0.05 && val < 1.00) {  // sanity: $0.05–$1.00/kWh
        result.electricityRate = Math.round(val * 1000) / 1000;
        break;
      }
    }
  }

  // ── Utility name ───────────────────────────────────────────────────────────
  const utilityPatterns = [
    // Major US utilities
    /\b(pacific gas (?:and|&) electric|pg&e|pge)\b/i,
    /\b(southern california edison|sce)\b/i,
    /\b(san diego gas (?:and|&) electric|sdg&e)\b/i,
    /\b(los angeles department of water (?:and|&) power|ladwp)\b/i,
    /\b(florida power (?:and|&) light|fpl)\b/i,
    /\b(duke energy)\b/i,
    /\b(dominion energy)\b/i,
    /\b(georgia power)\b/i,
    /\b(con ?edison|consolidated edison)\b/i,
    /\b(national grid)\b/i,
    /\b(eversource)\b/i,
    /\b(ameren)\b/i,
    /\b(comed|commonwealth edison)\b/i,
    /\b(peco energy)\b/i,
    /\b(pseg|public service electric)\b/i,
    /\b(xcel energy)\b/i,
    /\b(excel energy)\b/i,
    /\b(entergy)\b/i,
    /\b(centerpoint energy)\b/i,
    /\b(oncor)\b/i,
    /\b(austin energy)\b/i,
    /\b(salt lake city power|rocky mountain power)\b/i,
    /\b(arizona public service|aps)\b/i,
    /\b(salt river project|srp)\b/i,
    /\b(tucson electric power|tep)\b/i,
    /\b(nevada energy|nv energy)\b/i,
    /\b(puget sound energy|pse)\b/i,
    /\b(portland general electric|pge)\b/i,
    /\b(pacific power)\b/i,
    /\b(hawaiian electric|heco)\b/i,
    /\b(consumers energy)\b/i,
    /\b(detroit edison|dte energy)\b/i,
    /\b(ohio edison|firstenergy)\b/i,
    /\b(appalachian power|aep)\b/i,
    /\b(kentucky utilities|ku)\b/i,
    /\b(louisville gas (?:and|&) electric|lge)\b/i,
    /\b(tennessee valley authority|tva)\b/i,
    /\b(westar energy|evergy)\b/i,
    /\b(kansas city power (?:and|&) light|kcpl)\b/i,
    /\b(empire district electric)\b/i,
    /\b(oklahoma gas (?:and|&) electric|oge)\b/i,
    /\b(public service company of oklahoma|pso)\b/i,
    /\b(southwestern public service|sps)\b/i,
    /\b(new mexico gas|pnm)\b/i,
    /\b(el paso electric)\b/i,
    /\b(idaho power)\b/i,
    /\b(montana-dakota utilities|mdu)\b/i,
    /\b(black hills energy)\b/i,
    /\b(otter tail power)\b/i,
    /\b(minnesota power)\b/i,
    /\b(northern states power|nsp)\b/i,
    /\b(we energies|wisconsin energy)\b/i,
    /\b(madison gas (?:and|&) electric|mge)\b/i,
    /\b(alliant energy)\b/i,
    /\b(midamerican energy)\b/i,
    /\b(interstate power (?:and|&) light|ipl)\b/i,
    /\b(iowa state university utilities)\b/i,
    /\b(michigan gas utilities)\b/i,
    /\b(indiana michigan power)\b/i,
    /\b(indiana public service|nipsco)\b/i,
    /\b(ohio power|aep ohio)\b/i,
    /\b(columbia gas)\b/i,
    /\b(vectren|centerpoint)\b/i,
    /\b(southern indiana gas (?:and|&) electric|sigeco)\b/i,
    /\b(northern indiana public service|nipsco)\b/i,
    /\b(ohio valley electric|ovec)\b/i,
    /\b(dayton power (?:and|&) light|dp&l)\b/i,
    /\b(ohio edison)\b/i,
    /\b(cleveland electric illuminating|cei)\b/i,
    /\b(toledo edison)\b/i,
    /\b(jersey central power (?:and|&) light|jcp&l)\b/i,
    /\b(metropolitan edison|met-ed)\b/i,
    /\b(penelec|pennsylvania electric)\b/i,
    /\b(west penn power)\b/i,
    /\b(duquesne light)\b/i,
    /\b(pike electric)\b/i,
    /\b(nstar|eversource)\b/i,
    /\b(unitil)\b/i,
    /\b(green mountain power)\b/i,
    /\b(central vermont public service|cvps)\b/i,
    /\b(new hampshire electric cooperative|nhec)\b/i,
    /\b(unitil)\b/i,
    /\b(bangor hydro|emera maine)\b/i,
    /\b(central maine power|cmp)\b/i,
    /\b(national fuel gas)\b/i,
    /\b(niagara mohawk|national grid)\b/i,
    /\b(central hudson gas (?:and|&) electric)\b/i,
    /\b(orange (?:and|&) rockland utilities)\b/i,
    /\b(long island power authority|lipa)\b/i,
    /\b(pseg long island)\b/i,
    /\b(delmarva power)\b/i,
    /\b(pepco|potomac electric)\b/i,
    /\b(baltimore gas (?:and|&) electric|bge)\b/i,
    /\b(potomac edison)\b/i,
    /\b(virginia electric (?:and|&) power|vepco|dominion virginia power)\b/i,
    /\b(appalachian power)\b/i,
    /\b(american electric power|aep)\b/i,
    /\b(carolina power (?:and|&) light|cp&l|progress energy)\b/i,
    /\b(duke power|duke energy carolinas)\b/i,
    /\b(south carolina electric (?:and|&) gas|sceg)\b/i,
    /\b(georgia power)\b/i,
    /\b(gulf power)\b/i,
    /\b(mississippi power)\b/i,
    /\b(alabama power)\b/i,
    /\b(southern company)\b/i,
    /\b(tampa electric|teco)\b/i,
    /\b(duke energy florida)\b/i,
    /\b(gulf power)\b/i,
    /\b(keys energy services)\b/i,
    /\b(lakeland electric)\b/i,
    /\b(orlando utilities commission|ouc)\b/i,
    /\b(jea|jacksonville electric authority)\b/i,
    /\b(cleco)\b/i,
    /\b(entergy louisiana)\b/i,
    /\b(entergy mississippi)\b/i,
    /\b(entergy texas)\b/i,
    /\b(entergy arkansas)\b/i,
    /\b(southwestern electric power|swepco)\b/i,
    /\b(arkansas electric cooperative)\b/i,
    /\b(empire electric)\b/i,
    /\b(tri-state generation)\b/i,
    /\b(colorado springs utilities)\b/i,
    /\b(black hills colorado electric)\b/i,
    /\b(holy cross energy)\b/i,
    /\b(gunnison county electric)\b/i,
    /\b(intermountain rural electric)\b/i,
    /\b(poudre valley rea)\b/i,
    /\b(united power)\b/i,
    /\b(highline electric)\b/i,
    /\b(san isabel electric)\b/i,
    /\b(la plata electric)\b/i,
    /\b(empire electric association)\b/i,
    /\b(san luis valley rea)\b/i,
    /\b(white river electric)\b/i,
    /\b(yampa valley electric)\b/i,
    /\b(delta-montrose electric)\b/i,
    /\b(grand valley power)\b/i,
    /\b(moon lake electric)\b/i,
    /\b(uintah basin electric)\b/i,
    /\b(bridger valley electric)\b/i,
    /\b(carbon power (?:and|&) light)\b/i,
    /\b(central wyoming electric)\b/i,
    /\b(lower valley energy)\b/i,
    /\b(powder river energy)\b/i,
    /\b(sheridan electric)\b/i,
    /\b(wyrulec)\b/i,
    /\b(cheyenne light, fuel (?:and|&) power)\b/i,
    /\b(pacific corp|pacificorp)\b/i,
    /\b(nevada power|nv energy)\b/i,
    /\b(sierra pacific power)\b/i,
    /\b(nevada energy)\b/i,
    /\b(los alamos county utilities)\b/i,
    /\b(new mexico public service)\b/i,
    /\b(southwestern public service)\b/i,
    /\b(texas-new mexico power|tnmp)\b/i,
    /\b(lubbock power (?:and|&) light)\b/i,
    /\b(city of san antonio|cps energy)\b/i,
    /\b(city public service|cps)\b/i,
    /\b(brownsville public utilities)\b/i,
    /\b(garland power (?:and|&) light)\b/i,
    /\b(denton municipal electric)\b/i,
    /\b(greenville electric utility system)\b/i,
    /\b(lufkin industries)\b/i,
    /\b(new braunfels utilities)\b/i,
    /\b(san marcos electric utility)\b/i,
    /\b(seguin electric)\b/i,
    /\b(brenham municipal electric)\b/i,
    /\b(college station utilities)\b/i,
    /\b(bryan texas utilities)\b/i,
    /\b(reliant energy|nrg energy)\b/i,
    /\b(txu energy)\b/i,
    /\b(direct energy)\b/i,
    /\b(green mountain energy)\b/i,
    /\b(gexa energy)\b/i,
    /\b(constellation energy)\b/i,
    /\b(ambit energy)\b/i,
    /\b(bounce energy)\b/i,
    /\b(champion energy)\b/i,
    /\b(cirro energy)\b/i,
    /\b(discount power)\b/i,
    /\b(electricity maine)\b/i,
    /\b(energy plus)\b/i,
    /\b(first choice power)\b/i,
    /\b(frontier utilities)\b/i,
    /\b(ignite energy)\b/i,
    /\b(infinite energy)\b/i,
    /\b(just energy)\b/i,
    /\b(luminant energy)\b/i,
    /\b(mp2 energy)\b/i,
    /\b(nordic energy)\b/i,
    /\b(nueces electric cooperative)\b/i,
    /\b(penstar power)\b/i,
    /\b(powertochoose)\b/i,
    /\b(pulse power)\b/i,
    /\b(reliant)\b/i,
    /\b(spark energy)\b/i,
    /\b(stream energy)\b/i,
    /\b(tara energy)\b/i,
    /\b(think energy)\b/i,
    /\b(tri eagle energy)\b/i,
    /\b(verde energy)\b/i,
    /\b(veteran energy)\b/i,
    /\b(viridian energy)\b/i,
    /\b(volt power)\b/i,
    /\b(watt energy)\b/i,
    /\b(yep energy)\b/i,
  ];

  for (const pattern of utilityPatterns) {
    const m = text.match(pattern);
    if (m) {
      // Capitalize properly
      result.utilityName = m[1]
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
        .replace(/\bAnd\b/g, 'and')
        .replace(/\bOf\b/g, 'of')
        .replace(/\b(Pg&e|Pge)\b/i, 'PG&E')
        .replace(/\b(Sce)\b/i, 'SCE')
        .replace(/\b(Sdg&e)\b/i, 'SDG&E')
        .replace(/\b(Fpl)\b/i, 'FPL')
        .replace(/\b(Aep)\b/i, 'AEP')
        .replace(/\b(Dte)\b/i, 'DTE')
        .replace(/\b(Tva)\b/i, 'TVA')
        .replace(/\b(Nv Energy)\b/i, 'NV Energy');
      break;
    }
  }

  // ── State code from address ────────────────────────────────────────────────
  const statePattern = /\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/;
  const stateM = text.match(statePattern);
  if (stateM) {
    const validStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
    if (validStates.includes(stateM[1])) {
      result.stateCode = stateM[1];
    }
  }

  // ── Account number ─────────────────────────────────────────────────────────
  const acctM = text.match(/(?:account|acct)(?:\s+(?:number|no|#))?[:\s]+([0-9\-]{6,20})/i);
  if (acctM) result.accountNumber = acctM[1].trim();

  // ── Service address ────────────────────────────────────────────────────────
  const addrM = text.match(/(?:service\s+address|premises|property)[:\s]+([^\n]{10,80})/i);
  if (addrM) result.serviceAddress = addrM[1].trim();

  // ── Confidence ────────────────────────────────────────────────────────────
  const found = [result.monthlyKwh, result.electricityRate, result.utilityName].filter(Boolean).length;
  result.confidence = found >= 3 ? 'high' : found >= 2 ? 'medium' : 'low';

  return result;
}

// ─── POST /api/engineering/parse-bill ─────────────────────────────────────────
// Accepts multipart/form-data with a PDF or image file
// Returns parsed bill data: kWh, rate, utility name, state
export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    // ── Read file as ArrayBuffer ───────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let extractedText = '';

    // ── PDF: extract text using pdftotext (poppler-utils) ─────────────────
    if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
      try {
        const { execSync } = await import('child_process');
        const { writeFileSync, unlinkSync } = await import('fs');
        const { tmpdir } = await import('os');
        const { join } = await import('path');

        const tmpIn = join(tmpdir(), `bill-${Date.now()}.pdf`);
        const tmpOut = join(tmpdir(), `bill-${Date.now()}.txt`);

        writeFileSync(tmpIn, buffer);
        execSync(`pdftotext -layout "${tmpIn}" "${tmpOut}"`, { timeout: 15000 });
        const { readFileSync } = await import('fs');
        extractedText = readFileSync(tmpOut, 'utf-8');

        // Cleanup
        try { unlinkSync(tmpIn); } catch {}
        try { unlinkSync(tmpOut); } catch {}
      } catch (pdfErr) {
        console.warn('[parse-bill] pdftotext failed:', pdfErr);
        // Try raw text extraction as fallback
        extractedText = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
      }
    }
    // ── Image: return guidance (no OCR without external API) ──────────────
    else if (fileType.startsWith('image/') || fileName.match(/\.(jpg|jpeg|png|webp|gif)$/)) {
      // For images, we can't do OCR without an external API
      // Return a helpful response asking user to enter data manually
      return NextResponse.json({
        success: true,
        data: {
          annualKwh: null,
          monthlyKwh: null,
          electricityRate: null,
          utilityName: null,
          stateCode: null,
          accountNumber: null,
          serviceAddress: null,
          confidence: 'low',
          message: 'Image bills require manual entry. Please enter your kWh usage and rate from the bill.',
        },
      });
    }
    // ── Text file ─────────────────────────────────────────────────────────
    else if (fileType === 'text/plain' || fileName.endsWith('.txt')) {
      extractedText = buffer.toString('utf-8');
    }
    else {
      return NextResponse.json({
        success: false,
        error: `Unsupported file type: ${fileType}. Please upload a PDF or text file.`,
      }, { status: 400 });
    }

    if (!extractedText || extractedText.trim().length < 20) {
      return NextResponse.json({
        success: true,
        data: {
          annualKwh: null,
          monthlyKwh: null,
          electricityRate: null,
          utilityName: null,
          stateCode: null,
          accountNumber: null,
          serviceAddress: null,
          confidence: 'low',
          message: 'Could not extract text from this file. Please enter your usage data manually.',
        },
      });
    }

    // ── Parse extracted text ───────────────────────────────────────────────
    const parsed = extractFromText(extractedText);

    return NextResponse.json({
      success: true,
      data: {
        ...parsed,
        rawText: extractedText.substring(0, 500), // first 500 chars for debugging
      },
    });

  } catch (error: unknown) {
    console.error('[POST /api/engineering/parse-bill]', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}