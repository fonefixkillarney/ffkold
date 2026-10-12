// The platform sells exactly two plans. Everything about them (name, price,
// minutes, seat range) is read from be-enterdial/.env at request time - see
// utils/planConfig.js. This file only fixes the keys, their order, and the
// fallback names.
//
// The env keys kept their historical prefixes (PLAN_LIGHT_*, PLAN_SINGLE_*) so
// existing deployments and any Payment/Transaction rows already in Mongo stay
// readable after the pricing change.
export const PLAN_KEYS = ["light", "single"];

export const PLAN_DEFAULT_NAMES = {
    light: "Basic",
    single: "Professional",
};

// Low -> high. Used to classify a purchase as an upgrade or a downgrade.
export const PLAN_RANK = { light: 0, single: 1 };

export const isUpgrade = (fromKey, toKey) =>
    (PLAN_RANK[toKey] ?? -1) > (PLAN_RANK[fromKey] ?? -1);
