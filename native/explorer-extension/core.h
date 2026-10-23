#pragma once
#include <windows.h>
#include <string>
#include <vector>
inline constexpr wchar_t RegistryKey[] = L"Software\\FusionSoft\\O_Compare_Rust\\ExplorerIntegration";
inline const CLSID CommandClsid = {0x41d4b7a8,0x0eb1,0x48f0,{0xbe,0x33,0x66,0xb7,0x43,0x77,0x12,0x61}};
HRESULT ReadValue(const wchar_t* name, std::wstring& value, const wchar_t* key = RegistryKey);
HRESULT WriteValue(const wchar_t* name, const std::wstring& value, const wchar_t* key = RegistryKey);
HRESULT ReadLeftPath(std::wstring& path);
HRESULT WriteLeftPath(const std::wstring& path);
std::wstring QuoteWindowsArgument(const std::wstring& value);
std::wstring EscapeMenuText(const std::wstring& value);
HRESULT LaunchCompare(const std::wstring& executable,const std::wstring& left,const std::wstring& right);
HRESULT LaunchApplication(const std::wstring& executable,const std::vector<std::wstring>& arguments);
std::wstring InstalledAppPath(const std::wstring& moduleFile);
