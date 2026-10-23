#include "core.h"
#include <shellapi.h>
#include <shobjidl.h>
#include <cstdio>
// Optional end-to-end mode exercises the registered COM server with real shell items.
int RegisteredCompare(const wchar_t* left,const wchar_t* right){
  auto hr=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);if(FAILED(hr))return 1;
  IExplorerCommand* root=nullptr;IShellItem* item=nullptr;IShellItemArray* items=nullptr;IEnumExplorerCommand* children=nullptr;
  hr=CoCreateInstance(CommandClsid,nullptr,CLSCTX_LOCAL_SERVER,__uuidof(IExplorerCommand),reinterpret_cast<void**>(&root));
  for(int step=0;SUCCEEDED(hr)&&step<2;step++){
    hr=SHCreateItemFromParsingName(step?right:left,nullptr,__uuidof(IShellItem),reinterpret_cast<void**>(&item));
    if(SUCCEEDED(hr))hr=SHCreateShellItemArrayFromShellItem(item,__uuidof(IShellItemArray),reinterpret_cast<void**>(&items));
    if(SUCCEEDED(hr))hr=root->EnumSubCommands(&children);
    bool invoked=false;
    while(SUCCEEDED(hr)&&children){
      IExplorerCommand* child=nullptr;ULONG fetched=0;auto next=children->Next(1,&child,&fetched);if(next!=S_OK)break;
      GUID name={};child->GetCanonicalName(&name);
      if(name.Data1==CommandClsid.Data1+(step?2:1)){
        EXPCMDSTATE state=ECS_HIDDEN;hr=child->GetState(items,FALSE,&state);
        if(SUCCEEDED(hr)&&state==ECS_ENABLED){hr=child->Invoke(items,nullptr);invoked=true;}else hr=E_FAIL;
      }
      child->Release();if(invoked)break;
    }
    if(!invoked&&SUCCEEDED(hr))hr=E_FAIL;
    if(children){children->Release();children=nullptr;}if(items){items->Release();items=nullptr;}if(item){item->Release();item=nullptr;}
  }
  if(root)root->Release();CoUninitialize();printf("registered compare HRESULT: 0x%08X\n",static_cast<unsigned>(hr));return FAILED(hr)?1:0;
}
int wmain(int argc,wchar_t** argv){
  if(argc==4&&std::wstring(argv[1])==L"--registered")return RegisteredCompare(argv[2],argv[3]);
  int failed=0;
  for(const auto& value:{L"C:\\a b\\",L"C:\\ไทย & %!.txt",L"\\\\server\\share\\x.txt",L"a\"b",L""}){
    auto command=L"app.exe "+QuoteWindowsArgument(value);int argc=0;auto argv=CommandLineToArgvW(command.c_str(),&argc);
    if(!argv||argc!=2||std::wstring(argv[1])!=value){failed++;printf("argument roundtrip failed\n");}
    if(argv)LocalFree(argv);
  }
  if(EscapeMenuText(L"a&b")!=L"a&&b")failed++;
  if(InstalledAppPath(L"E:\\app\\resources\\explorer\\OCompare.Explorer.dll")!=L"E:\\app\\o-compare-rust.exe")failed++;
  const auto key=L"Software\\FusionSoft\\O_Compare\\Tests\\"+std::to_wstring(GetCurrentProcessId());
  std::wstring actual;
  if(WriteValue(L"LeftPath",L"C:\\ไทย & test.txt",key.c_str())!=S_OK||ReadValue(L"LeftPath",actual,key.c_str())!=S_OK||actual!=L"C:\\ไทย & test.txt")failed++;
  RegDeleteTreeW(HKEY_CURRENT_USER,key.c_str());
  if(SUCCEEDED(LaunchCompare(L"relative.exe",L"a",L"b")))failed++;
  // ตรวจ COM factory และคำสั่งจริงจาก DLL โดยไม่ลงทะเบียนเมนูทดสอบในระบบ
  wchar_t modulePath[32768];GetModuleFileNameW(nullptr,modulePath,32768);
  auto directory=std::wstring(modulePath);directory.resize(directory.find_last_of(L"\\/")+1);
  HMODULE dll=LoadLibraryW((directory+L"OCompare.Explorer.dll").c_str());
  if(!dll){failed++;printf("cannot load Explorer DLL\n");}
  else{
    using FactoryFn=HRESULT(__stdcall*)(REFCLSID,REFIID,void**);
    auto create=reinterpret_cast<FactoryFn>(GetProcAddress(dll,"DllGetClassObject"));
    IClassFactory* factory=nullptr;IExplorerCommand* command=nullptr;
    if(!create||FAILED(create(CommandClsid,IID_IClassFactory,reinterpret_cast<void**>(&factory))))failed++;
    else if(FAILED(factory->CreateInstance(nullptr,__uuidof(IExplorerCommand),reinterpret_cast<void**>(&command))))failed++;
    if(command){
      PWSTR title=nullptr;EXPCMDSTATE state=ECS_ENABLED;EXPCMDFLAGS flags=ECF_DEFAULT;
      if(FAILED(command->GetTitle(nullptr,&title))||!title||std::wstring(title)!=L"OCompare")failed++;
      CoTaskMemFree(title);
      if(FAILED(command->GetState(nullptr,FALSE,&state))||state!=ECS_HIDDEN)failed++;
      if(FAILED(command->GetFlags(&flags))||flags!=ECF_HASSUBCOMMANDS)failed++;
      IEnumExplorerCommand* children=nullptr;
      if(FAILED(command->EnumSubCommands(&children))||!children)failed++;
      if(children){IExplorerCommand* child=nullptr;ULONG fetched=0;if(children->Next(1,&child,&fetched)!=S_OK||fetched!=1)failed++;if(child)child->Release();children->Release();}
      command->Release();
    }
    if(factory)factory->Release();FreeLibrary(dll);
  }
  printf("native failures: %d\n",failed);return failed?1:0;
}
