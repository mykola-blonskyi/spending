import { z } from 'zod';

export const DELETE_CONFIRMATION = 'DELETE MY DATA';

export const deleteUserBodySchema = z.strictObject({ confirmation: z.string().max(200) });
