#include "battle_core.h"
#include <assert.h>
#include <stdint.h>
#include <string.h>
#include <fenv.h>
typedef struct {size_t records,finishes;double *output;} State;
static uint64_t bits(double value){uint64_t result;memcpy(&result,&value,sizeof result);return result;}
static void record(void *context,size_t attribute,const double *formula,double value){
 State *state=context;assert(attribute==state->records++);assert(state->finishes==0);
 assert(state->output[0]==-123); /* No premature output writes. */
 if(attribute==0){assert(formula[0]==1);assert(value==1);}
 if(attribute==15){assert(formula[0]==100);assert(value==100);}
}
static void finish(void *context,const double *values){
 State *state=context;assert(state->records==47);assert(state->finishes++==0);
 assert(values[0]==1);assert(bits(values[1])==bits(2.0));
 assert(values[15]==95.45); /* Formula observer precedes immunity softening. */
 assert(state->output[0]==-123);
}
int main(void){
 double rows[3][47]={{0}},output[47];for(size_t i=0;i<47;i++)output[i]=-123;
 rows[0][0]=1e16;rows[1][0]=-1e16;rows[2][0]=1;rows[0][1]=-0.0;rows[2][1]=2;
 rows[0][15]=100;
 BattleAttributeRows groups[10]={{0}};groups[0]=(BattleAttributeRows){rows,3};
 State state={0,0,output};
 assert(battle_calculate_attributes(groups,output,&state,record,finish)==0);
 assert(state.records==47&&state.finishes==1&&output[0]==1&&output[1]==2);
 state.records=0;state.finishes=0;
 assert(battle_calculate_attributes(groups,output,&state,0,finish)==1);
 assert(state.records==0&&state.finishes==0);
 groups[9]=(BattleAttributeRows){0,1};
 assert(battle_calculate_attributes(groups,output,&state,record,finish)==2);
 assert(state.records==0&&state.finishes==0);
 groups[9]=(BattleAttributeRows){0,0};
 int previous_round=fegetround();assert(fesetround(FE_DOWNWARD)==0);
 assert(battle_calculate_attributes(groups,output,&state,record,finish)==3);
 assert(state.records==0&&state.finishes==0);
 assert(fesetround(previous_round)==0);
 return 0;
}
