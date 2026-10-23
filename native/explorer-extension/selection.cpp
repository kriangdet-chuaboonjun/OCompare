#include "core.h"
#include <vector>
HRESULT ReadValue(const wchar_t* name, std::wstring& value, const wchar_t* key) {
  value.clear(); DWORD bytes=0;
  auto result=RegGetValueW(HKEY_CURRENT_USER,key,name,RRF_RT_REG_SZ,nullptr,nullptr,&bytes);
  if(result==ERROR_FILE_NOT_FOUND)return S_FALSE;
  if(result!=ERROR_SUCCESS)return HRESULT_FROM_WIN32(result);
  if(bytes<sizeof(wchar_t)||bytes>65536)return E_INVALIDARG;
  std::vector<wchar_t> buffer(bytes/sizeof(wchar_t)+1,0);
  result=RegGetValueW(HKEY_CURRENT_USER,key,name,RRF_RT_REG_SZ,nullptr,buffer.data(),&bytes);
  if(result!=ERROR_SUCCESS)return HRESULT_FROM_WIN32(result);
  value.assign(buffer.data());return value.empty()?S_FALSE:S_OK;
}
HRESULT WriteValue(const wchar_t* name,const std::wstring& value,const wchar_t* key) {
  if(value.empty()||value.size()>32767||value.find(L'\0')!=std::wstring::npos)return E_INVALIDARG;
  HKEY handle=nullptr;
  auto result=RegCreateKeyExW(HKEY_CURRENT_USER,key,0,nullptr,0,KEY_SET_VALUE,nullptr,&handle,nullptr);
  if(result!=ERROR_SUCCESS)return HRESULT_FROM_WIN32(result);
  result=RegSetValueExW(handle,name,0,REG_SZ,reinterpret_cast<const BYTE*>(value.c_str()),static_cast<DWORD>((value.size()+1)*sizeof(wchar_t)));
  RegCloseKey(handle);return HRESULT_FROM_WIN32(result);
}
HRESULT ReadLeftPath(std::wstring& path){return ReadValue(L"LeftPath",path);}
HRESULT WriteLeftPath(const std::wstring& path){return WriteValue(L"LeftPath",path);}
std::wstring EscapeMenuText(const std::wstring& value){
  std::wstring out;
  for(auto c:value){if(c<32)out+=L' ';else{out+=c;if(c==L'&')out+=L'&';}}
  return out;
}
