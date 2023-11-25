import type { ArrayFilter, BooleanFilter, NumberFilter, StringFilter, StringFilterCommon } from '@vimtur/common';

function createStringFilterCommon(field: string, options?: StringFilterCommon): object {
  if (!options || Object.keys(options).length === 0) {
    return {};
  }

  const filter: object = {};
  Object.assign(
    filter,
    options.equalsAny
      ? {
          $in: options.equalsAny,
        }
      : {},
  );
  Object.assign(
    filter,
    options.equalsAll
      ? {
          $all: options.equalsAll,
        }
      : {},
  );
  Object.assign(
    filter,
    options.equalsNone
      ? {
          $nin: options.equalsNone,
        }
      : {},
  );

  Object.assign(
    filter,
    options.exists !== undefined
      ? {
          $exists: options.exists,
        }
      : {},
  );

  if (Object.keys(filter).length === 0) {
    return {};
  }

  return {
    [field]: filter,
  };
}

export function createStringFilter(field: string, options?: StringFilter): object {
  const base = createStringFilterCommon(field, options);

  const likeFilters: object[] = [];

  if (options) {
    if (options.likeAny && options.likeAny.length > 0) {
      likeFilters.push({
        $or: options.likeAny.map((value) => {
          return {
            [field]: { $regex: `\\Q${value}\\E`, $options: 'i' },
          };
        }),
      });
    }

    if (options.likeAll && options.likeAll.length > 0) {
      likeFilters.push({
        $and: options.likeAll.map((value) => {
          return {
            [field]: { $regex: `\\Q${value}\\E`, $options: 'i' },
          };
        }),
      });
    }

    if (options.likeNone && options.likeNone.length > 0) {
      likeFilters.push({
        $and: options.likeNone.map((value) => {
          return {
            [field]: { $not: { $regex: `\\Q${value}\\E`, $options: 'i' } },
          };
        }),
      });
    }
  }

  if (Object.keys(base).length > 0) {
    likeFilters.push(base);
  }

  if (likeFilters.length === 0) {
    return {};
  }

  return {
    $and: likeFilters,
  };
}

export function createArrayFilter(field: string, options?: ArrayFilter): object {
  const stringFilter = options ? { ...options } : undefined;
  if (stringFilter) {
    delete stringFilter.exists;
  }

  const base = createStringFilterCommon(field, stringFilter);

  if (options?.exists !== undefined) {
    Object.assign(base, {
      [`${field}.0`]: { $exists: options.exists },
    });
  }

  return base;
}

export function createNumberFilter(field: string, options?: NumberFilter): object {
  const filters: object[] = [];

  if (!options) {
    return {};
  }

  if (options.min !== undefined) {
    filters.push({
      [field]: { $gte: options.min },
    });
  }

  if (options.max !== undefined) {
    if (options.max === 0) {
      filters.push({ $or: [{ [field]: { $lte: 0 } }, { [field]: { $exists: false } }] });
    } else {
      filters.push({
        [field]: { $gte: options.max },
      });
    }
  }

  if (options.equalsAny && options.equalsAny.length > 0) {
    filters.push({
      [field]: { $in: options.equalsAny },
    });
  }

  if (filters.length === 0) {
    return {};
  }

  return { $and: filters };
}

export function createBooleanFilter(field: string, options?: BooleanFilter): object {
  if (options === undefined) {
    return {};
  }

  if (options) {
    return { [field]: true };
  } else {
    return { $or: [{ [field]: false }, { [field]: { $exists: false } }] };
  }
}
