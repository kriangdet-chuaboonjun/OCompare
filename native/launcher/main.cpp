#include "core.h"
#include <shellapi.h>
// Keep the sparse-package identity in this small native launch host.
int WINAPI wWinMain(HINSTANCE,HINSTANCE,PWSTR,int){
  int argc=0;auto argv=CommandLineToArgvW(GetCommandLineW(),&argc);if(!argv)return 1;
  try{
    wchar_t own[32768];auto count=GetModuleFileNameW(nullptr,own,32768);if(!count||count>=32768){LocalFree(argv);return 1;}
    auto exe=InstalledAppPath(own);HRESULT hr;
    std::vector<std::wstring> args;for(int i=1;i<argc;i++)args.emplace_back(argv[i]);LocalFree(argv);argv=nullptr;
    hr=LaunchApplication(exe,args);
    if(FAILED(hr)){MessageBoxW(nullptr,L"Cannot start OCompare. Repair the installation.",L"OCompare",MB_OK|MB_ICONERROR);return 1;}return 0;
  }catch(...){if(argv)LocalFree(argv);return 1;}
}
