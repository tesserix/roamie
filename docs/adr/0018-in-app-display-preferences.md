# In-app display preferences

Display choices use the existing device-local accessibility preferences. The
record stays below 1 KiB and changes require no network requests or new service.
The UI updates on the next React render; failed storage writes leave the current
choice usable and show the existing persistence error. Older or invalid saved
values fall back to the phone settings.

Phone text size remains the default. Compact, Normal and Large explicitly use
Roamie's own sizes instead of the phone's scaling. A shared Text/TextInput pair
applies 0.9, 1 and 1.2 multipliers to both font size and explicit line height;
nested text inherits its parent. Touch targets retain their minimum sizes.
Screens import these components rather than mutating React Native defaults or
scaling the entire screen. Exported trip memory artwork and camera OCR overlays
keep their existing typography, independent of the in-app size choice.

Profile settings puts recovery controls first, with a capped system-text
multiplier so Reset to normal remains reachable even at the largest phone size.
Reset sets Normal text, Phone appearance and standard contrast. It preserves
voice, sound, vibration, account, wallet and trips. Users can reselect Phone text
size at any time. Appearance uses the existing light/dark palette and navigation
theme; high contrast remains independent. No data migration or release rollout
is required to revert these additive device-local preferences.
