#include <stdio.h>
#include <stdint.h>
#include <math.h>
#include "roamie_denoise.h"
int main(int argc, char **argv) {
 if(argc!=2)return 2;
 FILE *file=fopen(argv[1],"rb");if(!file)return 2;
 RoamieDenoiser *vad=roamie_denoise_create(); if(!vad)return 3;
 int16_t frame[480], clean[160];int count=0,voiced=0,last=-1,run=0,maxrun=0;double input=0,output=0;
 while(fread(frame,sizeof(int16_t),480,file)==480) {
  float probability=roamie_denoise_process(vad,frame,clean);if(probability<0)return 3;
  int yes=probability>.6f;voiced+=yes; if(yes){last=count;run++;if(run>maxrun)maxrun=run;}else run=0;
  for(int i=0;i<480;i++)input+=(double)frame[i]*frame[i];
  for(int i=0;i<160;i++)output+=(double)clean[i]*clean[i];
  count++;
 }
 printf("frames=%d speech_frames=%d last_speech_ms=%d max_run_ms=%d reduction_db=%.2f\n",count,voiced,(last+1)*10,maxrun*10,10*log10((input/3+1)/(output+1)));
 roamie_denoise_free(vad);fclose(file);return 0;
}
