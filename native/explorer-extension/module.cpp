#include "command.h"
#include <new>
std::atomic<long> g_references{0};HMODULE g_module=nullptr;
class Factory final:public IClassFactory{
  std::atomic<ULONG> refs{1};
public:
  Factory(){g_references++;}~Factory(){g_references--;}
  IFACEMETHODIMP QueryInterface(REFIID iid,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(iid==IID_IUnknown||iid==IID_IClassFactory){*out=static_cast<IClassFactory*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
  IFACEMETHODIMP_(ULONG) AddRef()override{return ++refs;}
  IFACEMETHODIMP_(ULONG) Release()override{auto n=--refs;if(!n)delete this;return n;}
  IFACEMETHODIMP CreateInstance(IUnknown* outer,REFIID iid,void** out)override{if(outer)return CLASS_E_NOAGGREGATION;return CreateCommand(CommandMode::Root,iid,out);}
  IFACEMETHODIMP LockServer(BOOL lock)override{if(lock)g_references++;else g_references--;return S_OK;}
};
extern "C" HRESULT __stdcall DllCanUnloadNow(){return g_references==0?S_OK:S_FALSE;}
extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid,REFIID iid,void** out){if(!out)return E_POINTER;*out=nullptr;if(clsid!=CommandClsid)return CLASS_E_CLASSNOTAVAILABLE;auto f=new(std::nothrow)Factory;if(!f)return E_OUTOFMEMORY;auto hr=f->QueryInterface(iid,out);f->Release();return hr;}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH){g_module=instance;DisableThreadLibraryCalls(instance);}return TRUE;}
