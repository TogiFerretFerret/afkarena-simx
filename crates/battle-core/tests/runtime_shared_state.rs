use battle_core::{entity::Vec2Arena, skill, unit, unit_skill_runtime::Runtime};

fn runtime() -> Runtime {
    let mut vectors = Vec2Arena::default();
    let zero = vectors.insert([0.0, 0.0]);
    let record = unit::Unit {
        state: unit::State::Idle, is_summoned: false, is_boss: false,
        camp: 1.0, hp: 100.0, mp: 10.0, attribs: unit::Attributes::default(), effects: 0,
        position: zero, previous_position: zero, walk_v: zero, knockup_v: zero,
        velocity: zero, knockup_accel: None, force_destination: None, destination: None,
        direction: 1.0, height: 0.0, z_speed: None, gravity_coef: 1.0,
        delay_terminate_timer: None, current_skill: Some(0), basic_skill: Some(0),
        skills: vec![0], buffs: vec![], speeder: 1.0, dt_action: 0.0,
        action_name: None, action_elapsed: 0.0, action_duration: 0.0, action_loop: false,
        fall_frozen_delay: None, fall_frozen_time: 0.0, knockup_time: 0.0,
        knock_state: false, knock_not_fall: false, walk_ignore_rect: false,
        global_cd: 2.0, frozen_model: false, thump_resistance_level: 0.0,
        thump_resistance_reduce: None, enter_delay_timer: None,
    };
    let units = unit::World {
        units: vec![record], vectors, effects: vec![unit::Effects::default()],
        skills: vec![unit::SkillView::default()], buffs: vec![], zero,
        gravity: -10.0, freeze_level: 0.0, local_bot: false,
    };
    let mut timelines = skill::World::default();
    timelines.units.push(skill::Unit::default());
    timelines.infos = vec![skill::Info::default(), skill::Info::default()];
    timelines.skills.push(skill::Skill::new(skill::InfoId(0), skill::UnitId(0)));
    Runtime::new(units, timelines, vec![skill::Number::Value(25.0), skill::Number::Value(75.0)]).unwrap()
}

#[test]
fn external_context_mutations_are_coherent_in_runtime_inspection() {
    let mut runtime = runtime();
    {
        let mut context = runtime.context();
        let unit = context.unit_mut(0).unwrap();
        unit.mp = -0.0;
        unit.global_cd = 7.5;
        unit.current_skill = None;
        let skill = context.skill_mut(skill::SkillId(0)).unwrap();
        skill.info = skill::InfoId(1);
        skill.target = skill::Reference::Value(skill::UnitId(0));
        context.set_info_speeder(skill::InfoId(1), skill::Number::Value(125.0)).unwrap();
    }
    runtime.inspect(|units, timelines| {
        assert_eq!(units.units[0].mp.to_bits(), (-0.0_f64).to_bits());
        assert_eq!(timelines.units[0].mp.to_bits(), (-0.0_f64).to_bits());
        assert_eq!(timelines.units[0].global_cd, 7.5);
        assert_eq!(timelines.units[0].current_skill, skill::Reference::Null);
        assert_eq!(units.skills[0].set_speeder, Some(125.0));
        assert_eq!(units.skills[0].target, Some(0));
    }).unwrap();
}

#[test]
fn inspection_within_a_host_context_keeps_current_number_payloads() {
    let mut runtime = runtime();
    let payload = f64::from_bits(0xfff8_0000_0000_0042);
    let mut context = runtime.context();
    context.unit_mut(0).unwrap().mp = payload;
    context.unit_mut(0).unwrap().global_cd = -0.0;
    context.skill_mut(skill::SkillId(0)).unwrap().target = skill::Reference::Null;
    *context.skill_unit_mut(skill::UnitId(0)).unwrap().manually_casting = true;
    context.inspect(|units, timelines| {
        assert_eq!(units.units[0].mp.to_bits(), payload.to_bits());
        assert_eq!(timelines.units[0].mp.to_bits(), payload.to_bits());
        assert_eq!(timelines.units[0].global_cd.to_bits(), (-0.0_f64).to_bits());
        assert_eq!(units.skills[0].target, None);
        assert!(timelines.units[0].manually_casting);
    }).unwrap();
}
