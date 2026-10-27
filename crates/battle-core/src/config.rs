//! Dense immutable contribution blocks for source unit attribute initialization.
//! Source: ed.unitAttribsManagerObj._finalCalculateAttribs. Values stay binary64;
//! no reassociation, integer narrowing, or replacement of the source sum order.

pub const ATTRIBUTE_COUNT: usize = 47;
pub const ATTRIBUTE_NAMES: [&str; ATTRIBUTE_COUNT] = [
    "HP","MP","ATK","ARM","MR","CRIT","MCRIT","HIT","DODG","HPR","MPR","HAST","MSPD","HEALRATIO","HEAL","PIMU","MIMU","HIMU","LFS","CRITRatio","VictimMpRatio","GainMpRatio","AllMpRatio","AllyMpRatio","MSFix","ATKHAST","HurtCrit","CRITP","CRITD","INSIGHT","RES","ICTRL","DCTRL","IPOS","DOTRATIO","DCRIT","DMIMU","DPIMU","MHIT","MDODG","ILH","DLH","AIMU","SHIELDRATIO","PRMpRatio","SHIELDADAPT","CRITPLU"
];
pub const GROUP_COUNT: usize = 10;
pub const GROUP_NAMES: [&str; GROUP_COUNT] = ["fixed_attribs","base_coefs","base_add","inner_coefs","addition_attribs","outer_coefs","outer_adds","sys_outer_coefs","sys_outer_adds","final_multiplier"];
pub type Attributes = [f64; ATTRIBUTE_COUNT];

/// Immutable arrays may be shared among independent battles. The order of rows
/// in each group is semantic: source accumulation visits them from first to last.
/// Missing Number properties can be represented as 0 because this source kernel
/// uses only their Number truthiness. Getter/string/BigInt inputs are excluded.
pub struct Contributions<'a> {
    pub groups: [&'a [Attributes]; GROUP_COUNT],
}

#[derive(Clone, Copy, Debug)]
pub struct Formula {
    pub fixed: f64, pub base_coef: f64, pub base_add: f64,
    pub inner_coef: f64, pub addition: f64, pub outer_coef: f64,
    pub outer_add: f64, pub sys_outer_coef: f64, pub sys_outer_add: f64,
    pub final_multiplier: f64,
}
impl Formula {
    pub fn values(self) -> [f64; GROUP_COUNT] {
        [self.fixed,self.base_coef,self.base_add,self.inner_coef,self.addition,self.outer_coef,self.outer_add,self.sys_outer_coef,self.sys_outer_add,self.final_multiplier]
    }
}
pub trait AttributeObserver {
    fn record_formula(&mut self, attribute: usize, formula: Formula, value: f64);
    fn finish_static(&mut self, values: &Attributes);
}
struct NoopObserver;
impl AttributeObserver for NoopObserver {
    #[inline(always)] fn record_formula(&mut self, _: usize, _: Formula, _: f64) {}
    #[inline(always)] fn finish_static(&mut self, _: &Attributes) {}
}
#[inline]
fn truthy(value: f64) -> bool { value != 0.0 && !value.is_nan() }
#[inline]
fn sum(rows: &[Attributes], attribute: usize) -> f64 {
    let mut result = 0.0;
    for row in rows {
        let value = row[attribute];
        if truthy(value) { result += value; }
    }
    result
}
#[inline]
fn soften_immunity(value: f64) -> f64 {
    // ed.compareFloat(a,95,">") first floors BOTH operands to four decimals.
    if (10000.0 * value).floor() > (10000.0_f64 * 95.0).floor() {
        let excess = value - 95.0;
        let capped = 95.0 + excess / (excess + 50.0) * 5.0;
        (100.0 * capped).floor() / 100.0
    } else { value }
}
#[inline]
pub fn calculate_attributes(contributions: &Contributions<'_>) -> Attributes {
    calculate_attributes_with(contributions, &mut NoopObserver)
}
pub fn calculate_attributes_with<O: AttributeObserver>(contributions: &Contributions<'_>, observer: &mut O) -> Attributes {
    let mut values = [0.0; ATTRIBUTE_COUNT];
    for attribute in 0..ATTRIBUTE_COUNT {
        let fixed = 0.0 + sum(contributions.groups[0],attribute);
        let base_coef = 1.0 + sum(contributions.groups[1],attribute);
        let base_add = 0.0 + sum(contributions.groups[2],attribute);
        let inner_coef = 1.0 + sum(contributions.groups[3],attribute);
        let addition = 0.0 + sum(contributions.groups[4],attribute);
        let outer_coef = 1.0 + sum(contributions.groups[5],attribute);
        let outer_add = 0.0 + sum(contributions.groups[6],attribute);
        let sys_outer_coef = 1.0 + sum(contributions.groups[7],attribute);
        let sys_outer_add = 0.0 + sum(contributions.groups[8],attribute);
        let final_multiplier = 0.0 + sum(contributions.groups[9],attribute);
        let mut value = sys_outer_coef * (sys_outer_add + ((fixed * base_coef + base_add) * inner_coef + addition) * outer_coef + outer_add);
        if truthy(final_multiplier) { value *= final_multiplier; }
        values[attribute] = value;
        observer.record_formula(attribute, Formula {fixed,base_coef,base_add,inner_coef,addition,outer_coef,outer_add,sys_outer_coef,sys_outer_add,final_multiplier},value);
    }
    values[15] = soften_immunity(values[15]);
    values[16] = soften_immunity(values[16]);
    observer.finish_static(&values);
    values
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn immutable_blocks_are_reused_but_results_are_owned_copies() {
        let mut row=[0.0; ATTRIBUTE_COUNT];row[0]=42.0;
        let fixed=[row];let inputs=Contributions {groups:[&fixed,&[],&[],&[],&[],&[],&[],&[],&[],&[]]};
        let mut a=calculate_attributes(&inputs);let b=calculate_attributes(&inputs);a[0]=2.0;
        assert_eq!(a[0],2.0);assert_eq!(b[0],42.0);assert_eq!(fixed[0][0],42.0);
    }
    #[test]
    fn sum_order_and_truthiness_preserve_source_behavior() {
        let mut a=[0.0; ATTRIBUTE_COUNT];let mut b=a;let mut c=a;
        a[0]=1e16;b[0]=-1e16;c[0]=1.0;a[1]=f64::NAN;b[1]=-0.0;c[1]=2.0;
        let fixed=[a,b,c];let inputs=Contributions {groups:[&fixed,&[],&[],&[],&[],&[],&[],&[],&[],&[]]};
        let values=calculate_attributes(&inputs);assert_eq!(values[0],1.0);assert_eq!(values[1],2.0);
    }
}
