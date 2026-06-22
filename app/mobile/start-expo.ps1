$env:EXPO_NO_DOCTOR = "true"
$env:EXPO_NO_VERSION_CHECK = "1"
cd $PSScriptRoot
& "..\..\node_modules\.bin\expo.cmd" start --clear
