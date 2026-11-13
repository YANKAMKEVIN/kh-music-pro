{
  "targets": [{
    "target_name": "kh_au_bridge",
    "sources": ["src/bridge.mm", "src/io.mm"],
    "xcode_settings": {
      "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
      "MACOSX_DEPLOYMENT_TARGET": "13.0",
      "OTHER_CPLUSPLUSFLAGS": ["-std=c++20", "-O2"]
    },
    "link_settings": { "libraries": ["-framework AudioToolbox", "-framework CoreFoundation", "-framework CoreAudio"] }
  }]
}
