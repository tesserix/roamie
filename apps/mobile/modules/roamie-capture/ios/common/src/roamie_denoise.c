#include "roamie_denoise.h"
#include "rnnoise.h"
#include "fvad.h"
#include <stdlib.h>
#include <math.h>
struct RoamieDenoiser { DenoiseState *noise; Fvad *vad; float history[63]; int cursor; };
static const float lowpass[63] = {1.1528652723e-19f, 1.0849700699e-20f, 3.3315384022e-05f, 9.2891714339e-05f, 5.6973723815e-05f, -1.8094177016e-04f, -4.7623938029e-04f, -4.1112139868e-04f, 3.0563838848e-04f, 1.2920745669e-03f, 1.4750864278e-03f, -1.7639854615e-18f, -2.5162494707e-03f, -3.7796319762e-03f, -1.5504494959e-03f, 3.6845969945e-03f, 7.7613572397e-03f, 5.6048445829e-03f, -3.5970042003e-03f, -1.3445455520e-02f, -1.3841487196e-02f, 7.5928836456e-18f, 2.0201456605e-02f, 2.8776555979e-02f, 1.1403328025e-02f, -2.6760928262e-02f, -5.7264952629e-02f, -4.3716470960e-02f, 3.1566635503e-02f, 1.4883895214e-01f, 2.5644299866e-01f, 3.0000845263e-01f, 2.5644299866e-01f, 1.4883895214e-01f, 3.1566635503e-02f, -4.3716470960e-02f, -5.7264952629e-02f, -2.6760928262e-02f, 1.1403328025e-02f, 2.8776555979e-02f, 2.0201456605e-02f, 7.5928836456e-18f, -1.3841487196e-02f, -1.3445455520e-02f, -3.5970042003e-03f, 5.6048445829e-03f, 7.7613572397e-03f, 3.6845969945e-03f, -1.5504494959e-03f, -3.7796319762e-03f, -2.5162494707e-03f, -1.7639854615e-18f, 1.4750864278e-03f, 1.2920745669e-03f, 3.0563838848e-04f, -4.1112139868e-04f, -4.7623938029e-04f, -1.8094177016e-04f, 5.6973723815e-05f, 9.2891714339e-05f, 3.3315384022e-05f, 1.0849700699e-20f, 1.1528652723e-19f};
RoamieDenoiser *roamie_denoise_create(void) {
  RoamieDenoiser *s = calloc(1, sizeof(*s));
  if (!s) return NULL;
  s->noise = rnnoise_create();
  if (!s->noise) { free(s); return NULL; }
  s->vad = fvad_new();
  if (!s->vad) { rnnoise_destroy(s->noise); free(s); return NULL; }
  fvad_set_sample_rate(s->vad, 48000); fvad_set_mode(s->vad, 2);
  return s;
}
void roamie_denoise_free(RoamieDenoiser *s) { if (s) { rnnoise_destroy(s->noise); fvad_free(s->vad); free(s); } }
float roamie_denoise_process(RoamieDenoiser *s, const int16_t *input, int16_t *output) {
  if (!s || !input || !output) return -1;
  float frame[480];
  for (int i=0; i<480; i++) frame[i] = input[i];
  float probability = rnnoise_process_frame(s->noise, frame, frame);
  for (int i=0; i<480; i++) {
    s->history[s->cursor] = frame[i];
    if (i%3 == 2) {
      float sample=0;
      for (int j=0; j<63; j++) sample += lowpass[j] * s->history[(s->cursor-j+63)%63];
      output[i/3] = (int16_t)lrintf(fmaxf(-32768, fminf(32767, sample)));
    }
    s->cursor = (s->cursor+1)%63;
  }
  return fvad_process(s->vad, input, 480) == 1 ? probability : 0;
}
