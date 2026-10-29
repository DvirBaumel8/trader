import { SetMetadata } from '@nestjs/common';

export const ALLOW_API_KEY = 'allowApiKey';

/** Marks a handler or controller that accepts a `kb_` API key as well as a login. */
export const AllowApiKey = () => SetMetadata(ALLOW_API_KEY, true);
