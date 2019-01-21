class DeepMerge {
    static merge(into, from) {
        for (const key of Object.keys(from)) {
            switch (typeof(from[key])) {
                case 'undefined':
                    delete into[key];
                    break;
                case 'object':
                    if (Array.isArray(from[key])) {
                        into[key] = from[key];
                        break;
                    }
                    if (!into[key]) {
                        into[key] = {};
                    }
                    DeepMerge.merge(into[key], from[key]);
                    break;
                default:
                    into[key] = from[key];
                    break;
            }
        }
        return into;
    }
}

module.exports = DeepMerge;
