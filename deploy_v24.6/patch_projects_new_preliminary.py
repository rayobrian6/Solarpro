with open('app/projects/new/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── Patch 1: Add client lookup to get usage data ────────────────────────────
# After addProject() succeeds, call preliminary with client data
old_handle_submit = """  const handleSubmit = async () => {
    if (!selectedClient || !selectedType || !name) return;
    setSaving(true);
    const toastId = toast.loading('Creating project...', 'Setting up design studio');
    try {
      // ✅ Phase 4: addProject() handles POST → DB → store update → localStorage mirror
      // No more direct fetch() + localSaveProject() — the store owns this flow
      const project = await addProject({
        clientId: selectedClient,
        name,
        systemType: selectedType,
        notes,
      });

      toast.update(toastId, {
        type: 'success',
        title: `Project "${project.name}" created!`,
        message: 'Opening design studio...',
      });
      setTimeout(() => router.push(`/design?projectId=${project.id}`), 600);
    } catch (e: any) {
      console.error('[NewProject] handleSubmit error:', e);
      toast.update(toastId, {
        type: 'error',
        title: 'Project could not be created',
        message: e?.message || 'Please try again. If the problem persists, refresh the page.',
      });
    } finally {
      setSaving(false);
    }
  };"""

new_handle_submit = """  const handleSubmit = async () => {
    if (!selectedClient || !selectedType || !name) return;
    setSaving(true);
    const toastId = toast.loading('Creating project...', 'Setting up design studio');
    try {
      // ✅ Phase 4: addProject() handles POST → DB → store update → localStorage mirror
      const project = await addProject({
        clientId: selectedClient,
        name,
        systemType: selectedType,
        notes,
      });

      // ── Engineering Seed: call preliminary endpoint with client usage data ──
      // This generates the engineering_seed + synthetic layout + production records
      // so the engineering modules and proposal are pre-populated when the user opens the project.
      const client = clients.find(c => c.id === selectedClient);
      if (client && (client.annualKwh > 0 || client.averageMonthlyBill > 0)) {
        toast.update(toastId, {
          type: 'loading',
          title: `Project "${project.name}" created!`,
          message: 'Generating engineering seed from usage data...',
        });
        try {
          // Extract state code from client address
          const stateCode = client.state || null;
          const annualKwh = client.annualKwh > 0
            ? client.annualKwh
            : (client.averageMonthlyBill > 0 && client.utilityRate > 0
                ? Math.round((client.averageMonthlyBill / client.utilityRate) * 12)
                : 0);

          await fetch('/api/engineering/preliminary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: project.id,
              annualKwh,
              monthlyKwh: client.averageMonthlyKwh || Math.round(annualKwh / 12),
              electricityRate: client.utilityRate || null,
              utilityName: client.utilityProvider || '',
              stateCode,
              address: [client.address, client.city, client.state, client.zip].filter(Boolean).join(', '),
            }),
          });
          // Non-blocking — if it fails, project still opens fine
        } catch (seedErr) {
          console.warn('[NewProject] Engineering seed generation failed (non-fatal):', seedErr);
        }
      }

      toast.update(toastId, {
        type: 'success',
        title: `Project "${project.name}" created!`,
        message: 'Opening design studio...',
      });
      setTimeout(() => router.push(`/design?projectId=${project.id}`), 600);
    } catch (e: any) {
      console.error('[NewProject] handleSubmit error:', e);
      toast.update(toastId, {
        type: 'error',
        title: 'Project could not be created',
        message: e?.message || 'Please try again. If the problem persists, refresh the page.',
      });
    } finally {
      setSaving(false);
    }
  };"""

if old_handle_submit in content:
    content = content.replace(old_handle_submit, new_handle_submit)
    print('✅ Wired preliminary call into project creation')
else:
    print('❌ Could not find handleSubmit function')

with open('app/projects/new/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done.')