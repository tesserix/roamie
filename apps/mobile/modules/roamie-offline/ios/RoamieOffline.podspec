Pod::Spec.new do |s|
  s.name = 'RoamieOffline'
  s.version = '1.0.0'
  s.summary = 'On-device translation for Roamie'
  s.description = 'Download and manage on-device language models.'
  s.license = { :type => 'Proprietary' }
  s.author = 'Tesserix'
  s.homepage = 'https://tesserix.app'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/tesserix/roamie.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'GoogleMLKit/Translate', '8.0.0'
  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
