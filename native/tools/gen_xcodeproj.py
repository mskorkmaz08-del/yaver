#!/usr/bin/env python3
"""Writes native/Yaver.xcodeproj from the files in native/Yaver.

One multiplatform app target (iPhone + Mac) with every .swift file under
native/Yaver and the asset catalog. Run it after adding or renaming a file:
    python3 native/tools/gen_xcodeproj.py
The output is plain text and deterministic, so it diffs cleanly in git.
"""
import hashlib
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # native/
SRC = os.path.join(ROOT, "Yaver")
PROJ = os.path.join(ROOT, "Yaver.xcodeproj")
BUNDLE_ID = "io.github.mskorkmaz08.yaver"
VERSION = "1.0"
BUILD = "1"


def oid(*parts):
    return hashlib.md5("/".join(parts).encode()).hexdigest()[:24].upper()


def q(s):
    s = str(s)
    if re.fullmatch(r"[A-Za-z0-9_./]+", s):
        return s
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    swift, groups = [], {}  # groups: relative dir -> [child ids]
    assets = None
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames[:] = sorted(d for d in dirnames if not d.endswith(".xcassets"))
        rel = os.path.relpath(dirpath, SRC)
        rel = "" if rel == "." else rel
        groups.setdefault(rel, [])
        for d in dirnames:
            groups[rel].append(("group", os.path.join(rel, d) if rel else d))
        for f in sorted(filenames):
            if f.endswith(".swift"):
                p = os.path.join(rel, f) if rel else f
                swift.append(p)
                groups[rel].append(("file", p))
        if os.path.isdir(os.path.join(dirpath, "Assets.xcassets")):
            assets = os.path.join(rel, "Assets.xcassets") if rel else "Assets.xcassets"
            groups[rel].append(("file", assets))

    target = oid("target")
    project = oid("project")
    product = oid("product")
    o = []  # output lines
    w = o.append
    w("// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n")

    w("\n/* Begin PBXBuildFile section */\n")
    for p in swift:
        w(f"\t\t{oid('build', p)} /* {os.path.basename(p)} in Sources */ = {{isa = PBXBuildFile; fileRef = {oid('ref', p)} /* {os.path.basename(p)} */; }};\n")
    if assets:
        w(f"\t\t{oid('build', assets)} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {oid('ref', assets)} /* Assets.xcassets */; }};\n")
    w("/* End PBXBuildFile section */\n")

    w("\n/* Begin PBXFileReference section */\n")
    for p in swift:
        n = os.path.basename(p)
        w(f"\t\t{oid('ref', p)} /* {n} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {q(n)}; sourceTree = \"<group>\"; }};\n")
    if assets:
        w(f"\t\t{oid('ref', assets)} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = \"<group>\"; }};\n")
    w(f"\t\t{product} /* Yaver.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Yaver.app; sourceTree = BUILT_PRODUCTS_DIR; }};\n")
    w("/* End PBXFileReference section */\n")

    frameworks = oid("frameworks")
    w("\n/* Begin PBXFrameworksBuildPhase section */\n")
    w(f"\t\t{frameworks} /* Frameworks */ = {{\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n")
    w("/* End PBXFrameworksBuildPhase section */\n")

    main_group, products_group = oid("group", "<main>"), oid("group", "<products>")
    w("\n/* Begin PBXGroup section */\n")
    w(f"\t\t{main_group} = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t{oid('group', 'Yaver')} /* Yaver */,\n\t\t\t\t{products_group} /* Products */,\n\t\t\t);\n\t\t\tsourceTree = \"<group>\";\n\t\t}};\n")
    w(f"\t\t{products_group} /* Products */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t{product} /* Yaver.app */,\n\t\t\t);\n\t\t\tname = Products;\n\t\t\tsourceTree = \"<group>\";\n\t\t}};\n")
    for rel in sorted(groups):
        gid = oid("group", "Yaver" if rel == "" else rel)
        name = "Yaver" if rel == "" else os.path.basename(rel)
        kids = "".join(
            f"\t\t\t\t{oid('group', p) if kind == 'group' else oid('ref', p)} /* {os.path.basename(p)} */,\n" for kind, p in groups[rel]
        )
        w(f"\t\t{gid} /* {name} */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n{kids}\t\t\t);\n\t\t\tpath = {q(name)};\n\t\t\tsourceTree = \"<group>\";\n\t\t}};\n")
    w("/* End PBXGroup section */\n")

    sources, resources = oid("sources"), oid("resources")
    tconfigs, pconfigs = oid("tconfigs"), oid("pconfigs")
    w("\n/* Begin PBXNativeTarget section */\n")
    w(f"""\t\t{target} /* Yaver */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {tconfigs} /* Build configuration list for PBXNativeTarget "Yaver" */;
\t\t\tbuildPhases = (
\t\t\t\t{sources} /* Sources */,
\t\t\t\t{frameworks} /* Frameworks */,
\t\t\t\t{resources} /* Resources */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tname = Yaver;
\t\t\tproductName = Yaver;
\t\t\tproductReference = {product} /* Yaver.app */;
\t\t\tproductType = "com.apple.product-type.application";
\t\t}};
""")
    w("/* End PBXNativeTarget section */\n")

    w("\n/* Begin PBXProject section */\n")
    w(f"""\t\t{project} /* Project object */ = {{
\t\t\tisa = PBXProject;
\t\t\tattributes = {{
\t\t\t\tBuildIndependentTargetsInParallel = 1;
\t\t\t\tLastSwiftUpdateCheck = 1400;
\t\t\t\tLastUpgradeCheck = 1400;
\t\t\t\tTargetAttributes = {{
\t\t\t\t\t{target} = {{
\t\t\t\t\t\tCreatedOnToolsVersion = 14.0;
\t\t\t\t\t}};
\t\t\t\t}};
\t\t\t}};
\t\t\tbuildConfigurationList = {pconfigs} /* Build configuration list for PBXProject "Yaver" */;
\t\t\tcompatibilityVersion = "Xcode 14.0";
\t\t\tdevelopmentRegion = en;
\t\t\thasScannedForEncodings = 0;
\t\t\tknownRegions = (
\t\t\t\ten,
\t\t\t\tBase,
\t\t\t);
\t\t\tmainGroup = {main_group};
\t\t\tproductRefGroup = {products_group} /* Products */;
\t\t\tprojectDirPath = "";
\t\t\tprojectRoot = "";
\t\t\ttargets = (
\t\t\t\t{target} /* Yaver */,
\t\t\t);
\t\t}};
""")
    w("/* End PBXProject section */\n")

    w("\n/* Begin PBXResourcesBuildPhase section */\n")
    res = f"\t\t\t\t{oid('build', assets)} /* Assets.xcassets in Resources */,\n" if assets else ""
    w(f"\t\t{resources} /* Resources */ = {{\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n{res}\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n")
    w("/* End PBXResourcesBuildPhase section */\n")

    w("\n/* Begin PBXSourcesBuildPhase section */\n")
    files = "".join(f"\t\t\t\t{oid('build', p)} /* {os.path.basename(p)} in Sources */,\n" for p in swift)
    w(f"\t\t{sources} /* Sources */ = {{\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n{files}\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n")
    w("/* End PBXSourcesBuildPhase section */\n")

    common_project = {
        "ALWAYS_SEARCH_USER_PATHS": "NO",
        "CLANG_ENABLE_MODULES": "YES",
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "COPY_PHASE_STRIP": "NO",
        "ENABLE_STRICT_OBJC_MSGSEND": "YES",
        "GCC_NO_COMMON_BLOCKS": "YES",
        "IPHONEOS_DEPLOYMENT_TARGET": "16.0",
        "MACOSX_DEPLOYMENT_TARGET": "13.0",
        "SWIFT_VERSION": "5.0",
    }
    debug_project = {**common_project, "DEBUG_INFORMATION_FORMAT": "dwarf", "ENABLE_TESTABILITY": "YES", "GCC_OPTIMIZATION_LEVEL": "0",
                     "ONLY_ACTIVE_ARCH": "YES", "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG", "SWIFT_OPTIMIZATION_LEVEL": "-Onone"}
    release_project = {**common_project, "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym", "ENABLE_NS_ASSERTIONS": "NO",
                       "SWIFT_COMPILATION_MODE": "wholemodule", "SWIFT_OPTIMIZATION_LEVEL": "-O", "VALIDATE_PRODUCT": "YES"}
    target_settings = {
        "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
        "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
        "CODE_SIGN_STYLE": "Automatic",
        "CURRENT_PROJECT_VERSION": BUILD,
        "DEVELOPMENT_TEAM": "",
        "ENABLE_PREVIEWS": "YES",
        "GENERATE_INFOPLIST_FILE": "YES",
        "INFOPLIST_KEY_CFBundleDisplayName": "Yaver",
        "INFOPLIST_KEY_ITSAppUsesNonExemptEncryption": "NO",
        "INFOPLIST_KEY_NSCameraUsageDescription": "Yaver uses the camera to photograph meals for the food diary.",
        "INFOPLIST_KEY_NSMicrophoneUsageDescription": "Yaver uses the microphone for voice chat with the assistant.",
        "INFOPLIST_KEY_NSPhotoLibraryUsageDescription": "Yaver opens photos of meals you pick for the food diary.",
        "INFOPLIST_KEY_LSApplicationCategoryType": "public.app-category.productivity",
        "INFOPLIST_KEY_UIApplicationSceneManifest_Generation": "YES",
        "INFOPLIST_KEY_UILaunchScreen_Generation": "YES",
        "INFOPLIST_KEY_UISupportedInterfaceOrientations": "UIInterfaceOrientationPortrait",
        "INFOPLIST_KEY_UIUserInterfaceStyle": "Dark",
        "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks",
        "LD_RUNPATH_SEARCH_PATHS[sdk=macosx*]": "$(inherited) @executable_path/../Frameworks",
        "MARKETING_VERSION": VERSION,
        "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE_ID,
        "PRODUCT_NAME": "$(TARGET_NAME)",
        "SDKROOT": "auto",
        "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator macosx",
        "SUPPORTS_MACCATALYST": "NO",
        "SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD": "NO",
        "SWIFT_EMIT_LOC_STRINGS": "YES",
        "TARGETED_DEVICE_FAMILY": "1,2",
    }

    def config(cid, name, settings):
        body = "".join(f"\t\t\t\t{q(k)} = {q(v)};\n" for k, v in sorted(settings.items()))
        return f"\t\t{cid} /* {name} */ = {{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {{\n{body}\t\t\t}};\n\t\t\tname = {name};\n\t\t}};\n"

    w("\n/* Begin XCBuildConfiguration section */\n")
    w(config(oid("pconf", "Debug"), "Debug", debug_project))
    w(config(oid("pconf", "Release"), "Release", release_project))
    w(config(oid("tconf", "Debug"), "Debug", target_settings))
    w(config(oid("tconf", "Release"), "Release", target_settings))
    w("/* End XCBuildConfiguration section */\n")

    w("\n/* Begin XCConfigurationList section */\n")
    for lid, kind, label, pre in [(pconfigs, "PBXProject", "Yaver", "pconf"), (tconfigs, "PBXNativeTarget", "Yaver", "tconf")]:
        w(f"""\t\t{lid} /* Build configuration list for {kind} "{label}" */ = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t{oid(pre, 'Debug')} /* Debug */,
\t\t\t\t{oid(pre, 'Release')} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};
""")
    w("/* End XCConfigurationList section */\n")
    w(f"\t}};\n\trootObject = {project} /* Project object */;\n}}\n")

    os.makedirs(os.path.join(PROJ, "xcshareddata", "xcschemes"), exist_ok=True)
    with open(os.path.join(PROJ, "project.pbxproj"), "w") as f:
        f.write("".join(o))
    ref = f"""<BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{target}"
               BuildableName = "Yaver.app"
               BlueprintName = "Yaver"
               ReferencedContainer = "container:Yaver.xcodeproj">
            </BuildableReference>"""
    scheme = f"""<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1400" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            {ref}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES">
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         {ref}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         {ref}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
"""
    with open(os.path.join(PROJ, "xcshareddata", "xcschemes", "Yaver.xcscheme"), "w") as f:
        f.write(scheme)
    print(f"Wrote {PROJ}: {len(swift)} Swift files" + (", assets" if assets else ""))


if __name__ == "__main__":
    main()
