#ifndef BATTLE_CORE_H
#define BATTLE_CORE_H
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
#define BATTLE_ATTRIBUTE_COUNT 47
#define BATTLE_ATTRIBUTE_GROUP_COUNT 10
typedef struct { const double (*rows)[BATTLE_ATTRIBUTE_COUNT]; size_t count; } BattleAttributeRows;
typedef void (*BattleRecordFormula)(void *context, size_t attribute, const double formula[10], double value);
typedef void (*BattleFinishStatic)(void *context, const double values[47]);
/* Input rows are immutable and must remain valid through both callbacks.
 * Output has 47 doubles, does not alias input, and is written after finish.
 * Both callbacks are required; their array pointers expire on return.
 * Return 0=success,1=missing pointer/callback,2=invalid alignment/count.
 * This kernel alone does not establish integrated battle equivalence. */
int battle_calculate_attributes(const BattleAttributeRows groups[10], double output[47], void *context,
    BattleRecordFormula record, BattleFinishStatic finish);
#ifdef __cplusplus
}
#endif
#endif
