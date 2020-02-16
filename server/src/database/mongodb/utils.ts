import { ArrayFilter, StringFilter, StringFilterCommon } from '../../types';

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
        $or: options.likeAny.map(value => {
          return {
            [field]: { $regex: `\\Q${value}\\E`, $options: 'i' },
          };
        }),
      });
    }

    if (options.likeAll && options.likeAll.length > 0) {
      likeFilters.push({
        $and: options.likeAll.map(value => {
          return {
            [field]: { $regex: `\\Q${value}\\E`, $options: 'i' },
          };
        }),
      });
    }

    if (options.likeNone && options.likeNone.length > 0) {
      likeFilters.push({
        $and: options.likeNone.map(value => {
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
  const base = createStringFilterCommon(field, options);

  if (options && options.exists !== undefined) {
    Object.assign(base, {
      [`${field}.0`]: { $exists: options.exists },
    });
  }

  return base;
}
