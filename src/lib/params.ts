export const idParamSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      pattern: '^[0-9]{1,15}$',
    },
  },
} as const;

export interface IdParams {
  id: string;
}
