//! Linux-only process cloning at the first measured host clock call. No runtime
//! serialization, shared mutable arena or source mechanic is introduced.
use std::fs::{File,OpenOptions};
use std::io::{self,Write};
use std::os::fd::AsRawFd;
use std::path::Path;
use std::sync::atomic::{AtomicBool,Ordering};
static CHILD:AtomicBool=AtomicBool::new(false);
#[cfg(target_os="linux")]
unsafe extern "C"{fn fork()->i32;fn dup2(old:i32,new:i32)->i32;fn waitpid(pid:i32,status:*mut i32,options:i32)->i32;fn _exit(status:i32)->!;fn fsync(fd:i32)->i32;}
fn flush()->io::Result<()>{io::stdout().flush()?;io::stderr().flush()}
fn durable(path:&Path,text:&str)->io::Result<()>{let mut file=OpenOptions::new().write(true).create(true).truncate(true).open(path)?;file.write_all(text.as_bytes())?;file.sync_all()}
#[cfg(target_os="linux")]
pub fn start(directory:&Path)->io::Result<()>{
 // Forking after other Rust threads have run can inherit locked allocators or
 // library mutexes. This driver is synchronous and checks the OS thread count.
 if std::fs::read_dir("/proc/self/task")?.count()!=1{return Err(io::Error::other("warm fork requires exactly one OS thread"))}
 std::fs::create_dir_all(directory)?;
 let files=(0..4).map(|index|Ok((File::create(directory.join(format!("process{index}.stdout")))?,File::create(directory.join(format!("process{index}.stderr")))?))).collect::<io::Result<Vec<_>>>()?;
 flush()?;
 let mut children=Vec::new();
 for index in 0..4{
  // SAFETY: this standalone driver has one OS thread, has dropped every I/O
  // lock and does not use async workers. Children resume private COW state.
  let pid=unsafe{fork()};
  if pid<0{
   let error=io::Error::last_os_error();wait_and_exit(directory,&children,Some(&error.to_string()));
  }
  if pid==0{
   // Only these two standard descriptors are redirected. Source host inputs
   // are already loaded/owned; no input cursor is shared through an fd.
   if unsafe{dup2(files[index].0.as_raw_fd(),1)}<0||unsafe{dup2(files[index].1.as_raw_fd(),2)}<0{unsafe{_exit(125)}}
   CHILD.store(true,Ordering::Relaxed);
   eprintln!("FORK_CHILD:{}:{}",index,std::process::id());
   return Ok(())
  }
  children.push((index,pid));
  let metadata=durable(&directory.join("children.json"),&format!("{{\"parentPid\":{},\"children\":[{}]}}\n",std::process::id(),children.iter().map(|(index,pid)|format!("{{\"index\":{index},\"pid\":{pid}}}")).collect::<Vec<_>>().join(",")));if let Err(error)=metadata{wait_and_exit(directory,&children,Some(&error.to_string()));}
 }
 wait_and_exit(directory,&children,None)
}
#[cfg(target_os="linux")]
fn wait_and_exit(directory:&Path,children:&[(usize,i32)],spawn_error:Option<&str>)->!{
 let mut rows=Vec::new();let mut failed=spawn_error.is_some()||children.len()!=4;
 for &(index,pid)in children{let mut status=0;let result=loop{let result=unsafe{waitpid(pid,&mut status,0)};if result<0&&io::Error::last_os_error().kind()==io::ErrorKind::Interrupted{continue}break result};let normal=result==pid&&(status&127)==0;let code=if normal{Some((status>>8)&255)}else{None};let signal=if result==pid&&!normal{Some(status&127)}else{None};failed|=code!=Some(0);rows.push(format!("{{\"index\":{index},\"pid\":{pid},\"waitStatus\":{status},\"status\":{},\"signal\":{},\"waitSucceeded\":{}}}",code.map(|n|n.to_string()).unwrap_or("null".into()),signal.map(|n|n.to_string()).unwrap_or("null".into()),result==pid));}
 let text=format!("{{\"parentPid\":{},\"spawnFailed\":{},\"children\":[{}]}}\n",std::process::id(),spawn_error.is_some(),rows.join(","));if let Some(error)=spawn_error{eprintln!("fork_spawn_error:{error}")}
 if durable(&directory.join("wait-results.json"),&text).is_err(){failed=true}let _=flush();unsafe{_exit(if failed{1}else{0})}
}
#[cfg(not(target_os="linux"))]
pub fn start(_: &Path)->io::Result<()>{Err(io::Error::other("warm fork is Linux-only"))}
pub fn is_child()->bool{CHILD.load(Ordering::Relaxed)}
#[cfg(target_os="linux")]
pub fn finish_child(status:i32)->!{let mut code=status;if flush().is_err(){code=126}if unsafe{fsync(1)}!=0||unsafe{fsync(2)}!=0{code=126}unsafe{_exit(code)}}
