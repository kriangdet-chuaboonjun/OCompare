#include "core.h"
#include <shobjidl.h>
#include <shlobj.h>
#include <wrl/client.h>
#include <filesystem>
#include <fstream>
#include <cstdio>
#include <thread>
#include <atomic>
using Microsoft::WRL::ComPtr;

// Load the production DLL in a disposable installation, with isolated HKCU state.
int FolderCommandTests(){
  int failed=0;
  auto check=[&](bool ok,const char* name){if(!ok){printf("folder command: %s\n",name);fflush(stdout);failed++;}};
  auto init=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
  if(FAILED(init))return 1;
  wchar_t executable[32768];GetModuleFileNameW(nullptr,executable,32768);
  const auto root=std::filesystem::temp_directory_path()/(L"OCompare-folder-"+std::to_wstring(GetCurrentProcessId()));
  const auto resources=root/L"resources"/L"explorer";
  const auto left=root/L"left & \u0e44\u0e17\u0e22";const auto right=root/L"right % folder";
  std::filesystem::create_directories(resources);
  std::filesystem::create_directory(left);std::filesystem::create_directory(right);
  const auto file=root/L"file.txt";std::ofstream(file)<<"test";
  std::filesystem::copy_file(executable,root/L"o-compare-rust.exe",std::filesystem::copy_options::overwrite_existing);
  std::filesystem::copy_file(std::filesystem::path(executable).parent_path()/L"OCompare.Explorer.dll",resources/L"OCompare.Explorer.dll",std::filesystem::copy_options::overwrite_existing);
  auto items=[](const std::filesystem::path& path){
    ComPtr<IShellItem> item;ComPtr<IShellItemArray> array;
    if(SUCCEEDED(SHCreateItemFromParsingName(path.c_str(),nullptr,IID_PPV_ARGS(&item))))SHCreateShellItemArrayFromShellItem(item.Get(),IID_PPV_ARGS(&array));
    return array;
  };
  auto leftItems=items(left);auto rightItems=items(right);auto fileItems=items(file);
  PIDLIST_ABSOLUTE ids[2]={};ComPtr<IShellItemArray> multiple;
  if(SUCCEEDED(SHParseDisplayName(left.c_str(),nullptr,&ids[0],0,nullptr))&&
     SUCCEEDED(SHParseDisplayName(right.c_str(),nullptr,&ids[1],0,nullptr))){
    SHCreateShellItemArrayFromIDLists(2,const_cast<PCIDLIST_ABSOLUTE*>(ids),&multiple);
  }
  for(auto id:ids)CoTaskMemFree(id);
  check(leftItems&&rightItems&&fileItems,"real shell items created");
  check(multiple!=nullptr,"real multiple-folder selection created");
  HKEY isolated=nullptr;const auto testKey=L"Software\\FusionSoft\\OCompareFolderTests\\"+std::to_wstring(GetCurrentProcessId());
  if(RegCreateKeyExW(HKEY_CURRENT_USER,testKey.c_str(),0,nullptr,0,KEY_ALL_ACCESS,nullptr,&isolated,nullptr)!=ERROR_SUCCESS){CoUninitialize();return 1;}
  if(RegOverridePredefKey(HKEY_CURRENT_USER,isolated)!=ERROR_SUCCESS){RegCloseKey(isolated);CoUninitialize();return 1;}
  auto dll=LoadLibraryW((resources/L"OCompare.Explorer.dll").c_str());
  check(dll!=nullptr,"load folder DLL");
  if(dll){
    using FactoryFn=HRESULT(__stdcall*)(REFCLSID,REFIID,void**);
    auto create=reinterpret_cast<FactoryFn>(GetProcAddress(dll,"DllGetClassObject"));
    const CLSID folderClsid={0x41d4b7ab,0x0eb1,0x48f0,{0xbe,0x33,0x66,0xb7,0x43,0x77,0x12,0x61}};
    ComPtr<IClassFactory> factory;ComPtr<IExplorerCommand> command;
    check(create&&SUCCEEDED(create(folderClsid,IID_PPV_ARGS(&factory))),"activate folder-specific CLSID");
    if(factory)check(SUCCEEDED(factory->CreateInstance(nullptr,IID_PPV_ARGS(&command))),"create folder command");
    if(command){
      auto title=[&](){PWSTR value=nullptr;auto hr=command->GetTitle(rightItems.Get(),&value);std::wstring result=value?value:L"";CoTaskMemFree(value);check(SUCCEEDED(hr),"get title");return result;};
      EXPCMDFLAGS flags=ECF_HASSUBCOMMANDS;command->GetFlags(&flags);
      check(flags==ECF_DEFAULT,"main-menu command has no flyout");
      ComPtr<IEnumExplorerCommand> children;
      check(command->EnumSubCommands(&children)==E_NOTIMPL,"no child commands");
      check(title()==L"Select Left Folder for Compare","initial selection action");
      EXPCMDSTATE state=ECS_ENABLED;
      command->GetState(nullptr,FALSE,&state);check(state==ECS_HIDDEN,"hide without selection");
      command->GetState(fileItems.Get(),FALSE,&state);check(state==ECS_HIDDEN,"hide on files");
      command->GetState(multiple.Get(),FALSE,&state);check(state==ECS_HIDDEN,"hide on multiple folders");
      check(command->Invoke(multiple.Get(),nullptr)==E_INVALIDARG,"reject multiple-folder invocation");
      check(command->Invoke(fileItems.Get(),nullptr)==E_INVALIDARG,"reject file invocation");
      check(command->Invoke(nullptr,nullptr)==E_INVALIDARG,"reject empty invocation");
      WriteLeftPath(file.wstring());
      check(title()==L"Select Left Folder for Compare","file selection does not change folder action");
      command->GetState(leftItems.Get(),FALSE,&state);check(state==ECS_ENABLED,"enable for folder");
      check(command->Invoke(leftItems.Get(),nullptr)==S_OK,"remember left folder");
      check(title()==L"Compare Folders to \u201cleft && \u0e44\u0e17\u0e22\u201d","compare action escapes remembered name");
      std::wstring remembered;ReadLeftPath(remembered);check(remembered==file.wstring(),"keep file selection independent");
      // Dismiss only dialogs on this test thread; do not interact with the user's windows.
      auto invokeWithDialog=[&](IShellItemArray* selection){
        std::atomic<bool> done{false};const auto threadId=GetCurrentThreadId();
        std::thread dismiss([&](){
          while(!done){
            EnumThreadWindows(threadId,[](HWND window,LPARAM)->BOOL{
              wchar_t name[64]={};GetClassNameW(window,name,64);
              if(std::wstring(name)==L"#32770")PostMessageW(window,WM_CLOSE,0,0);
              return TRUE;
            },0);Sleep(10);
          }
        });
        auto hr=command->Invoke(selection,nullptr);done=true;dismiss.join();return hr;
      };
      std::filesystem::rename(root/L"o-compare-rust.exe",root/L"saved.exe");
      check(FAILED(invokeWithDialog(rightItems.Get())),"report failed process launch");
      check(ReadLeftFolder(remembered)==S_OK&&remembered==left.wstring(),"failed launch keeps left folder for retry");
      std::filesystem::rename(root/L"saved.exe",root/L"o-compare-rust.exe");
      auto launched=invokeWithDialog(rightItems.Get());
      if(FAILED(launched)){printf("folder launch HRESULT: 0x%08X\n",static_cast<unsigned>(launched));fflush(stdout);}
      check(launched==S_OK,"launch folder pair");
      check(title()==L"Select Left Folder for Compare","reset for next pair after successful launch");
      std::wstring captured;
      for(int retry=0;retry<100;retry++){
        std::ifstream stream(right/L"received.txt",std::ios::binary);
        std::string bytes((std::istreambuf_iterator<char>(stream)),{});
        if(bytes.size()%sizeof(wchar_t)==0){captured.resize(bytes.size()/sizeof(wchar_t));if(!bytes.empty())memcpy(captured.data(),bytes.data(),bytes.size());}
        if(!captured.empty())break;Sleep(50);
      }
      check(captured==left.wstring()+L"\n"+right.wstring(),"real child process receives both literal folder paths");
      WriteLeftFolder((root/L"removed folder").wstring());
      check(invokeWithDialog(rightItems.Get())==S_OK,"recover from removed left folder");
      check(ReadLeftFolder(remembered)==S_OK&&remembered==right.wstring(),"stale left becomes current folder for next comparison");
    }
    command.Reset();factory.Reset();FreeLibrary(dll);
  }
  RegOverridePredefKey(HKEY_CURRENT_USER,nullptr);RegCloseKey(isolated);
  RegDeleteTreeW(HKEY_CURRENT_USER,testKey.c_str());
  leftItems.Reset();rightItems.Reset();fileItems.Reset();CoUninitialize();
  std::error_code error;std::filesystem::remove_all(root,error);
  return failed;
}
