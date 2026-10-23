#include "core.h"
#include <shlwapi.h>
std::wstring InstalledAppPath(const std::wstring& moduleFile){
  const auto slash=moduleFile.find_last_of(L"\\/");if(slash==std::wstring::npos)return {};
  auto path=moduleFile.substr(0,slash+1)+L"..\\..\\o-compare-rust.exe";wchar_t full[32768];
  auto count=GetFullPathNameW(path.c_str(),32768,full,nullptr);if(!count||count>=32768)return {};return full;
}
// กฎ quoting ของ Windows CRT: เพิ่ม backslash ก่อน quote และปลาย argument
std::wstring QuoteWindowsArgument(const std::wstring& value){
  std::wstring result=L"\"";size_t slashes=0;
  for(auto c:value){
    if(c==L'\\'){slashes++;continue;}
    if(c==L'\"')result.append(slashes*2+1,L'\\');else result.append(slashes,L'\\');
    slashes=0;result+=c;
  }
  result.append(slashes*2,L'\\');result+=L'\"';return result;
}
HRESULT LaunchCompare(const std::wstring& executable,const std::wstring& left,const std::wstring& right){
  if(left.empty()||right.empty())return E_INVALIDARG;
  return LaunchApplication(executable,{L"--compare",left,right});
}
HRESULT LaunchApplication(const std::wstring& executable,const std::vector<std::wstring>& arguments){
  if(executable.empty()||PathIsRelativeW(executable.c_str()))return E_INVALIDARG;
  const auto attrs=GetFileAttributesW(executable.c_str());
  if(attrs==INVALID_FILE_ATTRIBUTES)return HRESULT_FROM_WIN32(GetLastError());
  if(attrs&FILE_ATTRIBUTE_DIRECTORY)return E_INVALIDARG;
  auto command=QuoteWindowsArgument(executable);for(const auto& arg:arguments)command+=L" "+QuoteWindowsArgument(arg);
  STARTUPINFOW startup={sizeof(startup)};PROCESS_INFORMATION process={};
  if(!CreateProcessW(executable.c_str(),command.data(),nullptr,nullptr,FALSE,0,nullptr,nullptr,&startup,&process))return HRESULT_FROM_WIN32(GetLastError());
  CloseHandle(process.hThread);CloseHandle(process.hProcess);return S_OK;
}
