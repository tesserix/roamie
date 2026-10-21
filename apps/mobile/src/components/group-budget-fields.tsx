import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "./ui";
import { font, space, radius, useColors } from "@/constants/theme";
export function GroupField({
  label,
  ...props
}: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[font.caption, { color: c.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.faint}
        maxLength={160}
        {...props}
        style={[
          {
            minHeight: 52,
            padding: 14,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: radius.md,
            backgroundColor: c.surface,
            color: c.text,
            fontSize: 17,
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function GroupCopy({
  children,
  alert = false,
}: {
  children: ReactNode;
  alert?: boolean;
}) {
  const c = useColors();
  return (
    <Text
      accessibilityRole={alert ? "alert" : undefined}
      style={[font.body, { color: alert ? c.danger : c.muted }]}
    >
      {children}
    </Text>
  );
}
export function GroupSheet({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const c = useColors(),
    insets = useSafeAreaInsets();
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: c.background }}
      >
        <View
          style={{
            padding: space.md,
            paddingTop: space.md + insets.top,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Text
            accessibilityRole="header"
            style={[font.title, { flex: 1, color: c.text }]}
          >
            {title}
          </Text>
          <Button
            label="Close"
            kind="secondary"
            onPress={onClose}
            disabled={busy}
          />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: space.lg,
            paddingBottom: insets.bottom + space.xl,
            gap: space.md,
          }}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
