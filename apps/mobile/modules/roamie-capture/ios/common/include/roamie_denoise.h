#ifndef ROAMIE_DENOISE_H
#define ROAMIE_DENOISE_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct RoamieDenoiser RoamieDenoiser;
RoamieDenoiser *roamie_denoise_create(void);
void roamie_denoise_free(RoamieDenoiser *state);
/* One 10 ms frame: 480 samples at 48 kHz in, 160 at 16 kHz out. */
float roamie_denoise_process(RoamieDenoiser *state, const int16_t *input, int16_t *output);
#ifdef __cplusplus
}
#endif
#endif
