Pod::Spec.new do |s|
  s.name = 'RoamieCapture'
  s.version = '1.0.0'
  s.summary = 'Speech-aware microphone capture for Roamie'
  s.description = s.summary
  s.license = { :type => 'BSD-3-Clause', :file => 'common/LICENSE' }
  s.author = 'Tesserix'
  s.homepage = 'https://tesserix.app'
  s.platforms = { :ios => '16.0' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift', 'common/**/*.{c,h}'
  s.public_header_files = 'common/include/roamie_denoise.h'
  s.pod_target_xcconfig = { 'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) COMPILE_OPUS', 'DEFINES_MODULE' => 'YES', 'SWIFT_INCLUDE_PATHS' => '$(PODS_TARGET_SRCROOT)/common/include', 'HEADER_SEARCH_PATHS' => '$(PODS_TARGET_SRCROOT)/common/include $(PODS_TARGET_SRCROOT)/common/src $(PODS_TARGET_SRCROOT)/common/fvad/include $(PODS_TARGET_SRCROOT)/common/fvad/src' }
  s.swift_version = '5.9'
end
