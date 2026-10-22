import { createContext, useContext, type ComponentProps } from 'react';
import { StyleSheet, Text as NativeText, TextInput as NativeTextInput, type StyleProp, type TextStyle } from 'react-native';
import { TEXT_SIZES, useAccessibility, useAppColorScheme } from '@/lib/accessibility';

const NestedText = createContext(false);

function sizedStyle(style: StyleProp<TextStyle>, scale: number, nested = false): StyleProp<TextStyle> {
  const base = StyleSheet.flatten(style);
  return [style, {
    ...(!nested || typeof base?.fontSize === 'number' ? { fontSize: (base?.fontSize ?? 14) * scale } : {}),
    ...(typeof base?.lineHeight === 'number' ? { lineHeight: base.lineHeight * scale } : {}),
  }];
}

export function Text({ style, children, ...props }: ComponentProps<typeof NativeText>) {
  const { textSize } = useAccessibility();
  const scale = TEXT_SIZES.find(size => size.value === textSize)!.scale;
  const nested = useContext(NestedText);
  return <NestedText.Provider value>
    <NativeText {...props} allowFontScaling={scale === null ? props.allowFontScaling : false} style={scale === null ? style : sizedStyle(style, scale, nested)}>{children}</NativeText>
  </NestedText.Provider>;
}

export function TextInput({ style, ...props }: ComponentProps<typeof NativeTextInput>) {
  const { textSize } = useAccessibility();
  const scheme = useAppColorScheme();
  const scale = TEXT_SIZES.find(size => size.value === textSize)!.scale;
  return <NativeTextInput {...props} keyboardAppearance={props.keyboardAppearance ?? (scheme === 'dark' ? 'dark' : 'light')} allowFontScaling={scale === null ? props.allowFontScaling : false} style={scale === null ? style : sizedStyle(style, scale)} />;
}
