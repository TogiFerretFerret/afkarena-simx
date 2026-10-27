//! Pinned V8 13.6.233.17 ArrayTimSortImpl comparison schedule.
//! Source: third_party/v8/builtins/array-sort.tq, SHA256
//! 2ac3d8fc187e4f5096afb153d018390e2b250cde3e36badafe89da3faeebe55e.
//! Tokens refer to a separately rooted snapshot; receiver preprocessing,
//! comparator ToNumber, live JS object state and final writeback belong to the
//! VM adapter. No alternative algorithm runs after a comparator has executed.
//! Original TimSort copyright (c) 2001–2018 Python Software Foundation.

#[derive(Debug, PartialEq, Eq)]
pub enum SortError<E> { Comparator(E) }

#[derive(Clone, Copy)]
enum Storage { Work, Temp }

struct State<F> {
    work: Vec<u32>, temp: Vec<u32>, pending: Vec<(usize,usize)>,
    min_gallop: usize, compare: F,
}

pub fn sort_tokens<E>(input: &[u32], compare: impl FnMut(u32,u32)->Result<f64,E>) -> Result<Vec<u32>,SortError<E>> {
    let mut state=State{work:input.to_vec(),temp:Vec::new(),pending:Vec::new(),min_gallop:7,compare};
    state.run().map_err(SortError::Comparator)?;
    Ok(state.work)
}

impl<F> State<F> {
    fn at(&self, storage:Storage, index:isize)->u32 {
        match storage {Storage::Work=>self.work[index as usize],Storage::Temp=>self.temp[index as usize]}
    }
    fn copy_temp(&mut self,source:isize,dest:isize,length:isize) {
        self.work[dest as usize..(dest+length) as usize].copy_from_slice(&self.temp[source as usize..(source+length) as usize]);
    }
    fn copy_work(&mut self,source:isize,dest:isize,length:isize) {
        self.work.copy_within(source as usize..(source+length) as usize,dest as usize);
    }
}

impl<E,F:FnMut(u32,u32)->Result<f64,E>> State<F> {
    fn cmp(&mut self,a:u32,b:u32)->Result<f64,E> {
        let order=(self.compare)(a,b)?;
        Ok(if order.is_nan(){0.0}else{order})
    }
    fn count_run(&mut self,low:usize,high:usize)->Result<usize,E> {
        if low+1==high{return Ok(1);}
        let order=self.cmp(self.work[low+1],self.work[low])?;
        let descending=order<0.0;let mut length=2;let mut previous=self.work[low+1];
        for index in low+2..high {
            let current=self.work[index];let order=self.cmp(current,previous)?;
            if (descending&&order>=0.0)||(!descending&&order<0.0){break;}
            previous=current;length+=1;
        }
        if descending{self.work[low..low+length].reverse();}Ok(length)
    }
    fn insertion(&mut self,low:usize,start:usize,high:usize)->Result<(),E> {
        let start=if start==low{start+1}else{start};
        for index in start..high {
            let pivot=self.work[index];let(mut left,mut right)=(low,index);
            while left<right {let middle=left+((right-left)>>1);if self.cmp(pivot,self.work[middle])?<0.0{right=middle;}else{left=middle+1;}}
            self.work.copy_within(left..index,left+1);self.work[left]=pivot;
        }Ok(())
    }
    fn gallop_left(&mut self,storage:Storage,key:u32,base:isize,length:isize,hint:isize)->Result<isize,E> {
        let(mut last,mut offset)=(0isize,1isize);
        if self.cmp(self.at(storage,base+hint),key)?<0.0 {
            let maximum=length-hint;
            while offset<maximum {
                if self.cmp(self.at(storage,base+hint+offset),key)?>=0.0{break;}
                last=offset;offset=offset.saturating_mul(2).saturating_add(1);
            }
            offset=offset.min(maximum);last+=hint;offset+=hint;
        }else{
            let maximum=hint+1;
            while offset<maximum {
                if self.cmp(self.at(storage,base+hint-offset),key)?<0.0{break;}
                last=offset;offset=offset.saturating_mul(2).saturating_add(1);
            }
            offset=offset.min(maximum);let old_last=last;last=hint-offset;offset=hint-old_last;
        }
        last+=1;
        while last<offset {let middle=last+((offset-last)>>1);if self.cmp(self.at(storage,base+middle),key)?<0.0{last=middle+1;}else{offset=middle;}}
        Ok(offset)
    }
    fn gallop_right(&mut self,storage:Storage,key:u32,base:isize,length:isize,hint:isize)->Result<isize,E> {
        let(mut last,mut offset)=(0isize,1isize);
        if self.cmp(key,self.at(storage,base+hint))?<0.0 {
            let maximum=hint+1;
            while offset<maximum {
                if self.cmp(key,self.at(storage,base+hint-offset))?>=0.0{break;}
                last=offset;offset=offset.saturating_mul(2).saturating_add(1);
            }
            offset=offset.min(maximum);let old_last=last;last=hint-offset;offset=hint-old_last;
        }else{
            let maximum=length-hint;
            while offset<maximum {
                if self.cmp(key,self.at(storage,base+hint+offset))?<0.0{break;}
                last=offset;offset=offset.saturating_mul(2).saturating_add(1);
            }
            offset=offset.min(maximum);last+=hint;offset+=hint;
        }
        last+=1;
        while last<offset {let middle=last+((offset-last)>>1);if self.cmp(key,self.at(storage,base+middle))?<0.0{offset=middle;}else{last=middle+1;}}
        Ok(offset)
    }
    fn finish_low(&mut self,source:isize,dest:isize,length:isize){if length>0{self.copy_temp(source,dest,length);}}
    fn copy_b(&mut self,source:isize,dest:isize,length:isize,temp:isize){self.copy_work(source,dest,length);self.work[(dest+length)as usize]=self.temp[temp as usize];}
    fn merge_low(&mut self,base_a:isize,mut a:isize,base_b:isize,mut b:isize)->Result<(),E> {
        self.temp.clear();self.temp.extend_from_slice(&self.work[base_a as usize..(base_a+a)as usize]);
        let(mut dest,mut cursor_t,mut cursor_b)=(base_a,0isize,base_b);
        self.work[dest as usize]=self.work[cursor_b as usize];dest+=1;cursor_b+=1;b-=1;
        if b==0{self.finish_low(cursor_t,dest,a);return Ok(());}if a==1{self.copy_b(cursor_b,dest,b,cursor_t);return Ok(());}
        let mut minimum=self.min_gallop;
        loop {
            let(mut wins_a,mut wins_b)=(0isize,0isize);
            loop {
                if self.cmp(self.work[cursor_b as usize],self.temp[cursor_t as usize])?<0.0 {
                    self.work[dest as usize]=self.work[cursor_b as usize];dest+=1;cursor_b+=1;wins_b+=1;b-=1;wins_a=0;
                    if b==0{self.finish_low(cursor_t,dest,a);return Ok(());}if wins_b as usize>=minimum{break;}
                }else{
                    self.work[dest as usize]=self.temp[cursor_t as usize];dest+=1;cursor_t+=1;wins_a+=1;a-=1;wins_b=0;
                    if a==1{self.copy_b(cursor_b,dest,b,cursor_t);return Ok(());}if wins_a as usize>=minimum{break;}
                }
            }
            minimum+=1;let mut first=true;
            while wins_a>=7||wins_b>=7||first {
                first=false;minimum=minimum.saturating_sub(1).max(1);self.min_gallop=minimum;
                wins_a=self.gallop_right(Storage::Temp,self.work[cursor_b as usize],cursor_t,a,0)?;
                if wins_a>0{
                    self.copy_temp(cursor_t,dest,wins_a);dest+=wins_a;cursor_t+=wins_a;a-=wins_a;
                    if a==1{self.copy_b(cursor_b,dest,b,cursor_t);return Ok(());}if a==0{self.finish_low(cursor_t,dest,a);return Ok(());}
                }
                self.work[dest as usize]=self.work[cursor_b as usize];dest+=1;cursor_b+=1;b-=1;
                if b==0{self.finish_low(cursor_t,dest,a);return Ok(());}
                wins_b=self.gallop_left(Storage::Work,self.temp[cursor_t as usize],cursor_b,b,0)?;
                if wins_b>0{
                    self.copy_work(cursor_b,dest,wins_b);dest+=wins_b;cursor_b+=wins_b;b-=wins_b;
                    if b==0{self.finish_low(cursor_t,dest,a);return Ok(());}
                }
                self.work[dest as usize]=self.temp[cursor_t as usize];dest+=1;cursor_t+=1;a-=1;
                if a==1{self.copy_b(cursor_b,dest,b,cursor_t);return Ok(());}
            }
            minimum+=1;self.min_gallop=minimum;
        }
    }
    fn finish_high(&mut self,dest:isize,length:isize){if length>0{self.copy_temp(0,dest-(length-1),length);}}
    fn copy_a(&mut self,cursor:isize,dest:isize,length:isize,temp:isize){let dest=dest-length;let cursor=cursor-length;self.copy_work(cursor+1,dest+1,length);self.work[dest as usize]=self.temp[temp as usize];}
    fn merge_high(&mut self,base_a:isize,mut a:isize,base_b:isize,mut b:isize)->Result<(),E> {
        self.temp.clear();self.temp.extend_from_slice(&self.work[base_b as usize..(base_b+b)as usize]);
        let(mut dest,mut cursor_t,mut cursor_a)=(base_b+b-1,b-1,base_a+a-1);
        self.work[dest as usize]=self.work[cursor_a as usize];dest-=1;cursor_a-=1;a-=1;
        if a==0{self.finish_high(dest,b);return Ok(());}if b==1{self.copy_a(cursor_a,dest,a,cursor_t);return Ok(());}
        let mut minimum=self.min_gallop;
        loop {
            let(mut wins_a,mut wins_b)=(0isize,0isize);
            loop {
                if self.cmp(self.temp[cursor_t as usize],self.work[cursor_a as usize])?<0.0 {
                    self.work[dest as usize]=self.work[cursor_a as usize];dest-=1;cursor_a-=1;wins_a+=1;a-=1;wins_b=0;
                    if a==0{self.finish_high(dest,b);return Ok(());}if wins_a as usize>=minimum{break;}
                }else{
                    self.work[dest as usize]=self.temp[cursor_t as usize];dest-=1;cursor_t-=1;wins_b+=1;b-=1;wins_a=0;
                    if b==1{self.copy_a(cursor_a,dest,a,cursor_t);return Ok(());}if wins_b as usize>=minimum{break;}
                }
            }
            minimum+=1;let mut first=true;
            while wins_a>=7||wins_b>=7||first {
                first=false;minimum=minimum.saturating_sub(1).max(1);self.min_gallop=minimum;
                let k=self.gallop_right(Storage::Work,self.temp[cursor_t as usize],base_a,a,a-1)?;wins_a=a-k;
                if wins_a>0{dest-=wins_a;cursor_a-=wins_a;self.copy_work(cursor_a+1,dest+1,wins_a);a-=wins_a;if a==0{self.finish_high(dest,b);return Ok(());}}
                self.work[dest as usize]=self.temp[cursor_t as usize];dest-=1;cursor_t-=1;b-=1;
                if b==1{self.copy_a(cursor_a,dest,a,cursor_t);return Ok(());}
                let k=self.gallop_left(Storage::Temp,self.work[cursor_a as usize],0,b,b-1)?;wins_b=b-k;
                if wins_b>0{
                    dest-=wins_b;cursor_t-=wins_b;self.copy_temp(cursor_t+1,dest+1,wins_b);b-=wins_b;
                    if b==1{self.copy_a(cursor_a,dest,a,cursor_t);return Ok(());}if b==0{self.finish_high(dest,b);return Ok(());}
                }
                self.work[dest as usize]=self.work[cursor_a as usize];dest-=1;cursor_a-=1;a-=1;
                if a==0{self.finish_high(dest,b);return Ok(());}
            }
            minimum+=1;self.min_gallop=minimum;
        }
    }
    fn merge_at(&mut self,index:usize)->Result<(),E> {
        let(mut base_a,mut a)=self.pending[index];let(base_b,mut b)=self.pending[index+1];
        self.pending[index].1=a+b;self.pending.remove(index+1);
        let skip=self.gallop_right(Storage::Work,self.work[base_b],base_a as isize,a as isize,0)?as usize;
        base_a+=skip;a-=skip;if a==0{return Ok(());}
        b=self.gallop_left(Storage::Work,self.work[base_a+a-1],base_b as isize,b as isize,b as isize-1)?as usize;
        if b==0{return Ok(());}
        if a<=b{self.merge_low(base_a as isize,a as isize,base_b as isize,b as isize)}else{self.merge_high(base_a as isize,a as isize,base_b as isize,b as isize)}
    }
    fn invariant(&self,index:usize)->bool{index<2||self.pending[index-2].1>self.pending[index-1].1+self.pending[index].1}
    fn collapse(&mut self)->Result<(),E>{
        while self.pending.len()>1{
            let mut index=self.pending.len()-2;
            if !self.invariant(index+1)||!self.invariant(index){if self.pending[index-1].1<self.pending[index+1].1{index-=1;}self.merge_at(index)?;}
            else if self.pending[index].1<=self.pending[index+1].1{self.merge_at(index)?;}else{break;}
        }Ok(())
    }
    fn run(&mut self)->Result<(),E>{
        if self.work.len()<2{return Ok(());}
        let(mut remaining,mut low)=(self.work.len(),0usize);let mut n=remaining;let mut remainder=0;
        while n>=64{remainder|=n&1;n>>=1;}let minimum=n+remainder;
        while remaining!=0{
            let mut length=self.count_run(low,low+remaining)?;
            if length<minimum{let forced=minimum.min(remaining);self.insertion(low,low+length,low+forced)?;length=forced;}
            self.pending.push((low,length));self.collapse()?;low+=length;remaining-=length;
        }
        while self.pending.len()>1{let mut index=self.pending.len()-2;if index>0&&self.pending[index-1].1<self.pending[index+1].1{index-=1;}self.merge_at(index)?;}
        Ok(())
    }
}
