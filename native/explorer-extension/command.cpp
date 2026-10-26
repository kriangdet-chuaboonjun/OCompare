#include "command.h"
#include <shlwapi.h>
#include <wrl/client.h>
#include <new>
using Microsoft::WRL::ComPtr;
class Commands;
class Command final:public IExplorerCommand{
  std::atomic<ULONG> refs{1};CommandMode mode;
public:
  explicit Command(CommandMode m):mode(m){g_references++;}
  ~Command(){g_references--;}
  IFACEMETHODIMP QueryInterface(REFIID iid,void** out)override{
    if(!out)return E_POINTER;*out=nullptr;
    if(iid==IID_IUnknown||iid==__uuidof(IExplorerCommand)){*out=static_cast<IExplorerCommand*>(this);AddRef();return S_OK;}return E_NOINTERFACE;
  }
  IFACEMETHODIMP_(ULONG) AddRef()override{return ++refs;}
  IFACEMETHODIMP_(ULONG) Release()override{auto n=--refs;if(!n)delete this;return n;}
  IFACEMETHODIMP GetTitle(IShellItemArray*,PWSTR* out)override{
    if(!out)return E_POINTER;*out=nullptr;
    try{
      if(mode==CommandMode::Root)return SHStrDupW(L"OCompare",out);
      if(mode==CommandMode::Select)return SHStrDupW(L"Select Left for Compare",out);
      std::wstring left;auto hr=mode==CommandMode::Folder?ReadLeftFolder(left):ReadLeftPath(left);
      if(mode==CommandMode::Folder&&hr==S_FALSE)return SHStrDupW(L"Select Left Folder for Compare",out);
      if(hr!=S_OK)return hr==S_FALSE?E_FAIL:hr;
      // เอาชื่อท้ายพาธ โดยไม่ติดต่อ filesystem/network ตอนสร้างเมนู
      while(left.size()>3&&(left.back()==L'\\'||left.back()==L'/'))left.pop_back();
      const auto slash=left.find_last_of(L"\\/");auto name=slash==std::wstring::npos?left:left.substr(slash+1);
      if(name.empty())name=left;
      auto title=std::wstring(mode==CommandMode::Folder?L"Compare Folders to \u201c":L"Compare to \u201c")+EscapeMenuText(name)+L"\u201d";return SHStrDupW(title.c_str(),out);
    }catch(const std::bad_alloc&){return E_OUTOFMEMORY;}catch(...){return E_FAIL;}
  }
  IFACEMETHODIMP GetIcon(IShellItemArray*,PWSTR* out)override{
    if(!out)return E_POINTER;*out=nullptr;
    try{wchar_t path[32768];auto n=GetModuleFileNameW(g_module,path,32768);if(!n||n>=32768)return E_FAIL;auto icon=std::wstring(path)+L",-101";return SHStrDupW(icon.c_str(),out);}catch(...){return E_OUTOFMEMORY;}
  }
  IFACEMETHODIMP GetToolTip(IShellItemArray*,PWSTR* out)override{if(!out)return E_POINTER;*out=nullptr;return E_NOTIMPL;}
  IFACEMETHODIMP GetCanonicalName(GUID* out)override{if(!out)return E_POINTER;*out=CommandClsid;out->Data1+=static_cast<unsigned>(mode);return S_OK;}
  IFACEMETHODIMP GetState(IShellItemArray* items,BOOL,EXPCMDSTATE* state)override{
    if(!state)return E_POINTER;*state=ECS_HIDDEN;if(!items)return S_OK;
    try{
      DWORD count=0;if(FAILED(items->GetCount(&count))||count!=1)return S_OK;
      ComPtr<IShellItem> item;if(FAILED(items->GetItemAt(0,&item)))return S_OK;
      SFGAOF attributes=0;if(FAILED(item->GetAttributes(SFGAO_FILESYSTEM,&attributes))||!(attributes&SFGAO_FILESYSTEM))return S_OK;
      if(mode==CommandMode::Folder){
        if(FAILED(item->GetAttributes(SFGAO_FOLDER|SFGAO_STREAM,&attributes))||!(attributes&SFGAO_FOLDER)||(attributes&SFGAO_STREAM))return S_OK;
      }
      if(mode==CommandMode::Compare){std::wstring left;if(ReadLeftPath(left)!=S_OK)return S_OK;}
      *state=ECS_ENABLED;return S_OK;
    }catch(...){return E_FAIL;}
  }
  IFACEMETHODIMP Invoke(IShellItemArray* items,IBindCtx*)override{
    try{
      if(mode==CommandMode::Root)return E_NOTIMPL;
      DWORD count=0;if(!items||FAILED(items->GetCount(&count))||count!=1)return E_INVALIDARG;
      ComPtr<IShellItem> item;auto hr=items->GetItemAt(0,&item);if(FAILED(hr))return hr;
      PWSTR raw=nullptr;hr=item->GetDisplayName(SIGDN_FILESYSPATH,&raw);if(FAILED(hr))return hr;
      std::wstring path(raw);CoTaskMemFree(raw);
      if(mode==CommandMode::Folder){
        const auto attributes=GetFileAttributesW(path.c_str());
        if(attributes==INVALID_FILE_ATTRIBUTES)return HRESULT_FROM_WIN32(GetLastError());
        if(!(attributes&FILE_ATTRIBUTE_DIRECTORY))return E_INVALIDARG;
        std::wstring left;hr=ReadLeftFolder(left);
        if(hr==S_FALSE)hr=WriteLeftFolder(path);
        else if(hr==S_OK){
          const auto leftAttributes=GetFileAttributesW(left.c_str());
          // A stale left folder becomes a fresh selection instead of trapping the menu in Compare.
          if(leftAttributes==INVALID_FILE_ATTRIBUTES||!(leftAttributes&FILE_ATTRIBUTE_DIRECTORY)){
            hr=WriteLeftFolder(path);
            if(SUCCEEDED(hr))MessageBoxW(nullptr,L"The previous left folder is no longer available. This folder is now selected as the left folder. Right-click another folder to compare.",L"OCompare",MB_OK|MB_ICONINFORMATION);
          }else{
            wchar_t module[32768];auto n=GetModuleFileNameW(g_module,module,32768);
            hr=n&&n<32768?LaunchCompare(InstalledAppPath(module),left,path):E_FAIL;
            // Only consume the pair after CreateProcess succeeds; failed launches can be retried.
            if(SUCCEEDED(hr))hr=ClearLeftFolder();
          }
        }
        if(FAILED(hr))MessageBoxW(nullptr,L"The folder comparison command failed. Please check the selected folders and repair OCompare installation if needed.",L"OCompare",MB_OK|MB_ICONERROR);
        return hr;
      }
      if(mode==CommandMode::Select)hr=WriteLeftPath(path);
      else{std::wstring left;hr=ReadLeftPath(left);if(hr==S_OK){wchar_t module[32768];auto n=GetModuleFileNameW(g_module,module,32768);hr=n&&n<32768?LaunchCompare(InstalledAppPath(module),left,path):E_FAIL;}if(hr==S_FALSE)hr=HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);}
      if(FAILED(hr)){wchar_t code[32];swprintf_s(code,L"0x%08X",static_cast<unsigned>(hr));const auto message=L"Cannot start comparison for:\n"+path+L"\nError: "+code+L"\nPlease select the left item again or repair OCompare installation.";MessageBoxW(nullptr,message.c_str(),L"OCompare",MB_OK|MB_ICONERROR);}
      return hr;
    }catch(const std::bad_alloc&){return E_OUTOFMEMORY;}catch(...){return E_FAIL;}
  }
  IFACEMETHODIMP GetFlags(EXPCMDFLAGS* flags)override{if(!flags)return E_POINTER;*flags=mode==CommandMode::Root?ECF_HASSUBCOMMANDS:ECF_DEFAULT;return S_OK;}
  IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** out)override;
};
class Commands final:public IEnumExplorerCommand{
  std::atomic<ULONG> refs{1};ULONG index=0;bool compare;
public:
  explicit Commands(bool c):compare(c){g_references++;}~Commands(){g_references--;}
  IFACEMETHODIMP QueryInterface(REFIID iid,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(iid==IID_IUnknown||iid==__uuidof(IEnumExplorerCommand)){*out=static_cast<IEnumExplorerCommand*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
  IFACEMETHODIMP_(ULONG) AddRef()override{return ++refs;}
  IFACEMETHODIMP_(ULONG) Release()override{auto n=--refs;if(!n)delete this;return n;}
  IFACEMETHODIMP Next(ULONG count,IExplorerCommand** out,ULONG* fetched)override{
    if(!out||(!fetched&&count!=1))return E_POINTER;if(fetched)*fetched=0;ULONG n=0;
    while(n<count&&index<(compare?2u:1u)){
      auto mode=compare&&index==0?CommandMode::Compare:CommandMode::Select;
      auto hr=CreateCommand(mode,__uuidof(IExplorerCommand),reinterpret_cast<void**>(&out[n]));if(FAILED(hr))return hr;n++;index++;
    }
    if(fetched)*fetched=n;return n==count?S_OK:S_FALSE;
  }
  IFACEMETHODIMP Skip(ULONG count)override{auto total=compare?2u:1u;auto remaining=total-index;if(count>remaining){index=total;return S_FALSE;}index+=count;return S_OK;}
  IFACEMETHODIMP Reset()override{index=0;return S_OK;}
  IFACEMETHODIMP Clone(IEnumExplorerCommand** out)override{if(!out)return E_POINTER;auto c=new(std::nothrow)Commands(compare);if(!c)return E_OUTOFMEMORY;c->index=index;*out=c;return S_OK;}
};
HRESULT Command::EnumSubCommands(IEnumExplorerCommand** out){
  if(!out)return E_POINTER;*out=nullptr;if(mode!=CommandMode::Root)return E_NOTIMPL;
  try{std::wstring left;auto commands=new(std::nothrow)Commands(ReadLeftPath(left)==S_OK);if(!commands)return E_OUTOFMEMORY;*out=commands;return S_OK;}catch(...){return E_OUTOFMEMORY;}
}
HRESULT CreateCommand(CommandMode mode,REFIID iid,void** out){if(!out)return E_POINTER;*out=nullptr;auto c=new(std::nothrow)Command(mode);if(!c)return E_OUTOFMEMORY;auto hr=c->QueryInterface(iid,out);c->Release();return hr;}
