cmake_minimum_required(VERSION 3.22)
project(roamie_vad C CXX)
set(VAD_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../../../ios/common)
file(GLOB_RECURSE VAD_SOURCES ${VAD_ROOT}/src/*.c ${VAD_ROOT}/fvad/src/*.c)
add_library(roamie_vad SHARED vad-jni.cpp ${VAD_SOURCES})
target_include_directories(roamie_vad PRIVATE ${VAD_ROOT}/include ${VAD_ROOT}/src ${VAD_ROOT}/fvad/include ${VAD_ROOT}/fvad/src)

target_compile_definitions(roamie_vad PRIVATE COMPILE_OPUS)
target_link_libraries(roamie_vad m)
