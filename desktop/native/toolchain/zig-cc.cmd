@echo off
"%~dp0..\.toolchain\Lib\site-packages\ziglang\zig.exe" cc -target x86_64-windows-gnu %*
