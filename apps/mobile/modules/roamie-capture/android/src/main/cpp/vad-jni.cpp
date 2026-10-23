#include <jni.h>
#include "roamie_denoise.h"
extern "C" JNIEXPORT jlong JNICALL Java_app_tesserix_roamie_capture_RoamieCaptureModule_createVad(JNIEnv*, jobject) {
  return reinterpret_cast<jlong>(roamie_denoise_create());
}
extern "C" JNIEXPORT jboolean JNICALL Java_app_tesserix_roamie_capture_RoamieCaptureModule_processVad(JNIEnv* env, jobject, jlong handle, jbyteArray bytes) {
  if (!handle || env->GetArrayLength(bytes) != 9600) return false;
  jbyte data[9600]; env->GetByteArrayRegion(bytes, 0, 9600, data);
  int16_t samples[4800], clean[1600];
  for (int i = 0; i < 4800; i++) samples[i] = static_cast<int16_t>(static_cast<unsigned char>(data[2*i]) | (static_cast<unsigned char>(data[2*i+1]) << 8));
  int voiced = 0;
  for (int i = 0; i < 10; i++) voiced += roamie_denoise_process(reinterpret_cast<RoamieDenoiser*>(handle), samples + i*480, clean + i*160) > .6f;
  for (int i=0; i<1600; i++) { data[2*i]=clean[i]&255; data[2*i+1]=(static_cast<uint16_t>(clean[i])>>8)&255; }
  env->SetByteArrayRegion(bytes, 0, 3200, data);
  return voiced >= 3;
}
extern "C" JNIEXPORT void JNICALL Java_app_tesserix_roamie_capture_RoamieCaptureModule_freeVad(JNIEnv*, jobject, jlong handle) {
  roamie_denoise_free(reinterpret_cast<RoamieDenoiser*>(handle));
}
