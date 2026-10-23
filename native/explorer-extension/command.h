#pragma once
#include "core.h"
#include <shobjidl.h>
#include <atomic>
extern std::atomic<long> g_references;
extern HMODULE g_module;
enum class CommandMode{Root,Select,Compare};
HRESULT CreateCommand(CommandMode mode,REFIID iid,void** result);
