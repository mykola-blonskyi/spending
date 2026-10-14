import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard, SessionGuard } from './guards';
import { OidcClient } from './oidc.client';
import { SessionService } from './session.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, OidcClient, SessionService, SessionGuard, CsrfGuard],
  exports: [SessionGuard, CsrfGuard, SessionService],
})
export class AuthModule {}
