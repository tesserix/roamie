Pod::Spec.new do |s|
  s.name = 'RoamieOffline'
  s.version = '1.0.0'
  s.summary = 'On-device translation, OCR and model verification for Roamie'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Tesserix'
  s.homepage = 'https://github.com/tesserix/roamie'
  s.source = { :git => 'https://github.com/tesserix/roamie.git' }
  s.platform = :ios, '16.4'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
