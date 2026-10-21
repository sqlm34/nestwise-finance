import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { Search } from 'lucide-react-native';

export const colors = { ink: '#19372f', muted: '#70857c', line: '#dfe9e3', green: '#137c5a', pale: '#e8f3ed', bg: '#f4f7f5', amber: '#956a26', red: '#a34242' };
export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  text: { color: colors.ink, fontSize: 14, lineHeight: 22 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  title: { color: colors.ink, fontSize: 29, fontWeight: '700', letterSpacing: -0.9, lineHeight: 37 },
  h2: { color: colors.ink, fontSize: 18, fontWeight: '600', letterSpacing: -0.3, lineHeight: 26 },
  label: { color: colors.muted, fontSize: 10, letterSpacing: 1.5, fontWeight: '700' },
  card: { padding: 22, backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: colors.line, gap: 14 },
  button: { minHeight: 44, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  buttonText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 2 },
  input: { minHeight: 46, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 10, fontSize: 14, color: colors.ink },
});
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export function Button({ label, onPress, primary, icon, disabled = false, selected = false, testID }: {
  label: string; onPress: () => void; primary?: boolean; icon?: React.ReactNode; disabled?: boolean; selected?: boolean; testID?: string;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.button, (primary || selected) && { backgroundColor: primary ? colors.green : colors.pale, borderColor: primary ? colors.green : '#c5dfd0' }, { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}>
    {icon}<Text style={[styles.buttonText, primary && { color: 'white' }, selected && { color: colors.green }]}>{label}</Text>
  </Pressable>;
}
export function Badge({ children, warning }: { children: React.ReactNode; warning?: boolean }) {
  return <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: warning ? '#fbf2df' : colors.pale }}>
    <Text style={{ color: warning ? colors.amber : colors.green, fontSize: 10, fontWeight: '600', letterSpacing: 0.4 }}>{children}</Text>
  </View>;
}
export function Notice({ text, error = false }: { text: string; error?: boolean }) {
  return <View accessibilityRole={error ? 'alert' : undefined} style={{ padding: 14, borderRadius: 10, backgroundColor: error ? '#fceeee' : '#edf3ee', borderWidth: 1, borderColor: error ? '#f1caca' : '#dbe7de' }}>
    <Text style={[styles.muted, { color: error ? colors.red : '#50705e' }]}>{text}</Text>
  </View>;
}
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 10, borderColor: colors.line, borderWidth: 1, paddingLeft: 14 }}>
    <Search size={17} color={colors.muted} />
    <TextInput accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={colors.muted} value={value} onChangeText={onChange} style={[styles.input, { flex: 1, borderWidth: 0 }]} />
  </View>;
}
