import os
import uuid

def gen_id():
    return uuid.uuid4().hex[:24].upper()

# IDs
proj_id = "111111111111111111111101"
target_id = "111111111111111111111102"
main_group_id = "111111111111111111111103"
src_group_id = "111111111111111111111104"
prod_group_id = "111111111111111111111105"
app_product_id = "111111111111111111111106"

sources_phase_id = "111111111111111111111107"
frameworks_phase_id = "111111111111111111111108"
resources_phase_id = "111111111111111111111109"

proj_cfg_list = "11111111111111111111110A"
target_cfg_list = "11111111111111111111110B"

proj_debug_cfg = "11111111111111111111110C"
proj_release_cfg = "11111111111111111111110D"
target_debug_cfg = "11111111111111111111110E"
target_release_cfg = "11111111111111111111110F"

# Files: (name, filetype, kind, path)  kind: source | resource | plain
files = [
    ("AppDelegate.swift", "sourcecode.swift", "source", None),
    ("SceneDelegate.swift", "sourcecode.swift", "source", None),
    ("ViewController.swift", "sourcecode.swift", "source", None),
    ("Info.plist", "text.plist.xml", "plain", None),
    ("Assets.xcassets", "folder.assetcatalog", "resource", None),
    # Server manzili va offline sahifa — Android bilan bir xil manba (bitta joyda)
    ("app-config.json", "text.json", "resource", "../../config/app-config.json"),
    ("offline.html", "text.html", "resource", "../../android/app/src/main/assets/offline.html"),
]

file_entries = []
for name, ftype, kind, path in files:
    f_ref = gen_id()
    b_ref = gen_id() if kind in ("source", "resource") else None
    file_entries.append({
        "name": name,
        "ftype": ftype,
        "is_source": kind == "source",
        "is_resource": kind == "resource",
        "path": path or name,
        "f_ref": f_ref,
        "b_ref": b_ref
    })

pbx = f"""// !$*UTF8*$!
{{
	archiveVersion = 1;
	classes = {{
	}};
	objectVersion = 56;
	objects = {{

/* Begin PBXBuildFile section */
"""

for fe in file_entries:
    if fe["is_source"]:
        pbx += f"""\t\t{fe["b_ref"]} /* {fe["name"]} in Sources */ = {{isa = PBXBuildFile; fileRef = {fe["f_ref"]} /* {fe["name"]} */; }};\n"""
    elif fe["is_resource"]:
        pbx += f"""\t\t{fe["b_ref"]} /* {fe["name"]} in Resources */ = {{isa = PBXBuildFile; fileRef = {fe["f_ref"]} /* {fe["name"]} */; }};\n"""

pbx += f"""/* End PBXBuildFile section */

/* Begin PBXFileReference section */
\t\t{app_product_id} /* EduFocus.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = EduFocus.app; sourceTree = BUILT_PRODUCTS_DIR; }};
"""

for fe in file_entries:
    pbx += f"""\t\t{fe["f_ref"]} /* {fe["name"]} */ = {{isa = PBXFileReference; lastKnownFileType = {fe["ftype"]}; path = "{fe["path"]}"; name = "{fe["name"]}"; sourceTree = "<group>"; }};\n"""

pbx += f"""/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
\t\t{frameworks_phase_id} /* Frameworks */ = {{
\t\t\tisa = PBXFrameworksBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
\t\t{main_group_id} = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{src_group_id} /* EduFocus */,
\t\t\t\t{prod_group_id} /* Products */,
\t\t\t);
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{src_group_id} /* EduFocus */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
"""

for fe in file_entries:
    pbx += f"""\t\t\t\t{fe["f_ref"]} /* {fe["name"]} */,\n"""

pbx += f"""\t\t\t);
\t\t\tpath = EduFocus;
\t\t\tsourceTree = "<group>";
\t\t}};
\t\t{prod_group_id} /* Products */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{app_product_id} /* EduFocus.app */,
\t\t\t);
\t\t\tname = Products;
\t\t\tsourceTree = "<group>";
\t\t}};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
\t\t{target_id} /* EduFocus */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {target_cfg_list} /* Build configuration list for PBXNativeTarget "EduFocus" */;
\t\t\tbuildPhases = (
\t\t\t\t{sources_phase_id} /* Sources */,
\t\t\t\t{frameworks_phase_id} /* Frameworks */,
\t\t\t\t{resources_phase_id} /* Resources */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tname = EduFocus;
\t\t\tproductName = EduFocus;
\t\t\tproductReference = {app_product_id} /* EduFocus.app */;
\t\t\tproductType = "com.apple.product-type.application";
\t\t}};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
\t\t{proj_id} /* Project object */ = {{
\t\t\tisa = PBXProject;
\t\t\tattributes = {{
\t\t\t\tBuildIndependentTargetsInParallel = 1;
\t\t\t\tLastUpgradeCheck = 1500;
\t\t\t\tTargetAttributes = {{
\t\t\t\t\t{target_id} = {{
\t\t\t\t\t\tCreatedOnToolsVersion = 15.0;
\t\t\t\t\t}};
\t\t\t\t}};
\t\t\t}};
\t\t\tbuildConfigurationList = {proj_cfg_list} /* Build configuration list for PBXProject "EduFocus" */;
\t\t\tcompatibilityVersion = "Xcode 14.0";
\t\t\tdevelopmentRegion = en;
\t\t\thasScannedForEncodings = 0;
\t\t\tknownRegions = (
\t\t\t\ten,
\t\t\t\tBase,
\t\t\t);
\t\t\tmainGroup = {main_group_id};
\t\t\tproductRefGroup = {prod_group_id} /* Products */;
\t\t\tprojectDirPath = "";
\t\t\tprojectRoot = "";
\t\t\ttargets = (
\t\t\t\t{target_id} /* EduFocus */,
\t\t\t);
\t\t}};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
\t\t{resources_phase_id} /* Resources */ = {{
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
"""

for fe in file_entries:
    if fe["is_resource"]:
        pbx += f"""\t\t\t\t{fe["b_ref"]} /* {fe["name"]} in Resources */,\n"""

pbx += f"""\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
\t\t{sources_phase_id} /* Sources */ = {{
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
"""

for fe in file_entries:
    if fe["is_source"]:
        pbx += f"""\t\t\t\t{fe["b_ref"]} /* {fe["name"]} in Sources */,\n"""

pbx += f"""\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
\t\t{proj_debug_cfg} /* Debug */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{
\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ANALYZER_NONNULL = YES;
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;
\t\t\t\tCOPY_PHASE_STRIP = NO;
\t\t\t\tDEBUG_INFORMATION_FORMAT = dwarf;
\t\t\t\tENABLE_STRICT_OBJC_MSGSEND = YES;
\t\t\t\tENABLE_TESTABILITY = YES;
\t\t\t\tGCC_DYNAMIC_NO_PIC = NO;
\t\t\t\tGCC_OPTIMIZATION_LEVEL = 0;
\t\t\t\tGCC_PREPROCESSOR_DEFINITIONS = (
\t\t\t\t\t"DEBUG=1",
\t\t\t\t\t"$(inherited)",
\t\t\t\t);
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 16.0;
\t\t\t\tMTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE;
\t\t\t\tONLY_ACTIVE_ARCH = YES;
\t\t\t\tSDKROOT = iphoneos;
\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;
\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-Onone";
\t\t\t}};
\t\t\tname = Debug;
\t\t}};
\t\t{proj_release_cfg} /* Release */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{
\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ANALYZER_NONNULL = YES;
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;
\t\t\t\tCOPY_PHASE_STRIP = NO;
\t\t\t\tDEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
\t\t\t\tENABLE_NS_ASSERTIONS = NO;
\t\t\t\tENABLE_STRICT_OBJC_MSGSEND = YES;
\t\t\t\tGCC_OPTIMIZATION_LEVEL = s;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 16.0;
\t\t\t\tMTL_ENABLE_DEBUG_INFO = NO;
\t\t\t\tSDKROOT = iphoneos;
\t\t\t\tSWIFT_COMPILATION_MODE = "wholemodule";
\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-O";
\t\t\t\tVALIDATE_PRODUCT = YES;
\t\t\t}};
\t\t\tname = Release;
\t\t}};
\t\t{target_debug_cfg} /* Debug */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{
\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 40;
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = EduFocus/Info.plist;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 16.0;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (
\t\t\t\t\t"$(inherited)",
\t\t\t\t\t"@executable_path/Frameworks",
\t\t\t\t);
\t\t\t\tMARKETING_VERSION = 4.0.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.edufocus.app;
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
\t\t\t}};
\t\t\tname = Debug;
\t\t}};
\t\t{target_release_cfg} /* Release */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{
\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 40;
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = EduFocus/Info.plist;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 16.0;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (
\t\t\t\t\t"$(inherited)",
\t\t\t\t\t"@executable_path/Frameworks",
\t\t\t\t);
\t\t\t\tMARKETING_VERSION = 4.0.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.edufocus.app;
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
\t\t\t}};
\t\t\tname = Release;
\t\t}};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
\t\t{proj_cfg_list} /* Build configuration list for PBXProject "EduFocus" */ = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t{proj_debug_cfg} /* Debug */,
\t\t\t\t{proj_release_cfg} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};
\t\t{target_cfg_list} /* Build configuration list for PBXNativeTarget "EduFocus" */ = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t{target_debug_cfg} /* Debug */,
\t\t\t\t{target_release_cfg} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};
/* End XCConfigurationList section */

\t}};
\trootObject = {proj_id} /* Project object */;
}}
"""

os.makedirs("ios/EduFocus.xcodeproj", exist_ok=True)
with open("ios/EduFocus.xcodeproj/project.pbxproj", "w") as f:
    f.write(pbx)

print("Generated ios/EduFocus.xcodeproj/project.pbxproj successfully!")
