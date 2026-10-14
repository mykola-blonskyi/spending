import { Module } from '@nestjs/common';
import { AccessPolicy } from './access-policy';
import { FamilyService } from './family.service';
import { WorkspacesController } from './workspaces.controller';

@Module({
  controllers: [WorkspacesController],
  providers: [AccessPolicy, FamilyService],
  exports: [AccessPolicy],
})
export class WorkspacesModule {}
