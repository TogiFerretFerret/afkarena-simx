// Private benchmark transport shim. It never replaces a game clock or mechanic.
// The old per-worker elapsedMs includes time waiting here and is not throughput.
#define _GNU_SOURCE
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>
#include <dlfcn.h>
#include <stdlib.h>
static int (*next_vfprintf)(FILE *,const char *,va_list);
static unsigned starts;
static void fail(void){_exit(93);}
int fprintf(FILE *stream,const char *format,...){
 if(!next_vfprintf){next_vfprintf=dlsym(RTLD_NEXT,"vfprintf");if(!next_vfprintf)fail();}
 va_list args,copy;va_start(args,format);va_copy(copy,args);
 int start=0;
 if(stream==stderr&&!strcmp(format,"simx_measure_%s_ns:%llu\n")){
  const char *kind=va_arg(copy,const char*);start=kind&&!strcmp(kind,"start");
 }
 va_end(copy);
 int result=next_vfprintf(stream,format,args);va_end(args);
 if(start){
  if(++starts!=1||fflush(stderr))fail();
  char byte='R';ssize_t count;do{count=write(4,&byte,1);}while(count<0&&errno==EINTR);if(count!=1)fail();
  do{count=read(3,&byte,1);}while(count<0&&errno==EINTR);if(count!=1||byte!='G')fail();
  struct timespec value;if(clock_gettime(CLOCK_MONOTONIC,&value)||value.tv_sec<0||value.tv_nsec<0||value.tv_nsec>=1000000000)fail();
  unsigned long long ns=(unsigned long long)value.tv_sec*1000000000ULL+(unsigned long long)value.tv_nsec;
  if(dprintf(2,"simx_parallel_release_ns:%llu\n",ns)<0)fail();
 }
 return result;
}
