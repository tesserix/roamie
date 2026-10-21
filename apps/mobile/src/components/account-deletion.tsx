import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { font, useColors } from '@/constants/theme';
import { apiRequest } from '@/lib/trip-api';
import type { RequestStatus } from '@/lib/account-deletion-contract';

export function AccountDeletion() {
  const c = useColors();
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<RequestStatus | null>(null), [error, setError] = useState('');
  async function submit() {
    setBusy(true); setError('');
    try {
      const result = await apiRequest<RequestStatus>('/v1/auth/deletion-request', {}, res => res.json(), 12000);
      if (!result.id || !['pending', 'completed'].includes(result.status) || !Number.isFinite(Date.parse(result.dueAt))) throw new Error('Could not verify your request. Please retry.');
      setRequest(result); setConfirm(false);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not submit your request. Please retry.'); }
    finally { setBusy(false); }
  }
  const button = (label: string, action: () => void, danger = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={action} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', opacity: pressed || busy ? 0.6 : 1 })}>
    <Text style={[font.body, { color: danger ? c.danger : c.accent }]}>{label}</Text>
  </Pressable>;
  return <View style={{ gap: 8 }}>
    {request ? <>
      <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>{request.status === 'completed' ? 'Deletion completed' : 'Deletion requested'}</Text>
      <Text style={[font.body, { color: c.text }]}>{request.status === 'pending' ? `Our team will delete your Roamie account and associated personal data and email confirmation by ${new Date(request.dueAt).toLocaleDateString()}.` : 'Our team has marked this request complete. Check your email for the completion details.'}</Text>
      <Text selectable style={[font.body, { color: c.muted }]}>Request: {request.id} · sales@tesserix.app</Text>
    </> : confirm ? <>
      <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Delete your Roamie account?</Text>
      <Text style={[font.body, { color: c.text }]}>Our team at sales@tesserix.app will delete your Roamie account and associated personal data and email confirmation within 30 days. Deletion is permanent. You can submit here without sending an email.</Text>
      <Text style={[font.body, { color: c.muted }]}>We coordinate deletion with our providers. Limited legally required records and backup copies may remain for their required retention period; we explain any exception in our confirmation. Other people’s accounts and your accounts in other Tesserix apps are preserved.</Text>
      <Text style={[font.body, { color: c.muted }]}>To remove local wallet records and memories, clear Roamie’s app data or uninstall it on each device. Exported files and copies shared with others remain under their control.</Text>
      {button(busy ? 'Submitting request…' : 'Request account deletion', () => { void submit(); }, true)}
      {button('Keep my account', () => { setConfirm(false); setError(''); })}
    </> : button('Delete my account', () => setConfirm(true), true)}
    {error ? <Text accessibilityRole="alert" style={[font.body, { color: c.danger }]}>{error}</Text> : null}
  </View>;
}
