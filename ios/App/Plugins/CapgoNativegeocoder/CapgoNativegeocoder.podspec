Pod::Spec.new do |s|
  s.name = 'CapgoNativegeocoder'
  s.version = '7.1.8'
  s.summary = 'Fixed version of Capgo Native Geocoder plugin for Capacitor'
  s.license = 'MIT'
  s.homepage = 'https://github.com/Cap-go/native-geocoder'
  s.author = 'Martin Donadieu'
  s.source = { :git => 'https://github.com/Cap-go/native-geocoder.git', :tag => s.version.to_s }
  s.source_files = '**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.0'
end