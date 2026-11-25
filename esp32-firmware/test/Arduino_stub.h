// Minimal stand-ins for Arduino/ESP32 APIs, only for a host syntax/type check.
#pragma once
#include <string>
#include <cstdint>
#include <cstdio>
#include <cstdarg>
#include <cmath>
#include <cctype>
#include <cstdlib>
#define F(x) x
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define INPUT 0
#define INPUT_PULLUP 2
#define SERIAL_8N1 0
#define ADC_11db 3
inline bool isDigit(char c){return c>='0'&&c<='9';}
class String { public: std::string s;
  String(){} String(const char*c):s(c?c:""){} String(const std::string&x):s(x){}
  String(char c):s(1,c){} String(int v):s(std::to_string(v)){} String(long v):s(std::to_string(v)){}
  String(unsigned long v):s(std::to_string(v)){} String(unsigned int v):s(std::to_string(v)){}
  String(float v,int d=2){char b[40];snprintf(b,40,"%.*f",d,v);s=b;} String(double v,int d=2){char b[40];snprintf(b,40,"%.*f",d,v);s=b;}
  int length()const{return s.size();} const char* c_str()const{return s.c_str();}
  int indexOf(const String&x,int f=0)const{auto p=s.find(x.s,f);return p==std::string::npos?-1:(int)p;}
  int indexOf(char x,int f=0)const{auto p=s.find(x,f);return p==std::string::npos?-1:(int)p;}
  String substring(int a,int b=-1)const{if(b<0)b=s.size();return String(s.substr(a,b-a));}
  long toInt()const{return atol(s.c_str());} float toFloat()const{return atof(s.c_str());} double toDouble()const{return atof(s.c_str());}
  void trim(){} char operator[](int i)const{return s[i];}
  String& operator+=(const String&o){s+=o.s;return *this;} String& operator+=(char c){s+=c;return *this;} String& operator+=(const char*c){s+=c;return *this;}
  bool operator!=(const String&o)const{return s!=o.s;} bool operator==(const String&o)const{return s==o.s;}
};
inline String operator+(const String&a,const String&b){return String(a.s+b.s);}
inline String operator+(const String&a,const char*b){return String(a.s+b);}
inline String operator+(const char*a,const String&b){return String(std::string(a)+b.s);}
struct SerialT{ void begin(long){} void println(const char*s=""){} void println(const String&){} void print(const char*){} void print(const String&){}
  int printf(const char*f,...){return 0;} int available(){return 0;} int read(){return -1;} String readStringUntil(char){return String();} };
struct HardwareSerial: SerialT{ HardwareSerial(int){} void begin(long,int,int,int){} };
extern SerialT Serial;
struct Preferences{ bool begin(const char*,bool=false){return true;} void end(){} float getFloat(const char*,float d){return d;}
  size_t putBytes(const char*,const void*,size_t n){return n;} size_t getBytes(const char*,void*,size_t n){return n;} size_t getBytesLength(const char*){return 0;}
  bool getBool(const char*,bool d){return d;} size_t putBool(const char*,bool){return 1;} String getString(const char*,const String&d){return d;} size_t putString(const char*,const String&){return 1;} };
unsigned long millis(); void delay(unsigned long); void pinMode(int,int); void digitalWrite(int,int); int digitalRead(int); int analogRead(int); void analogSetAttenuation(int);
#define constrain(v,a,b) ((v)<(a)?(a):((v)>(b)?(b):(v)))
inline long map(long x,long a,long b,long c,long d){return (x-a)*(d-c)/(b-a)+c;}
