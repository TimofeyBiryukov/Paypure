import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./common/auth";
import { AllExceptionsFilter } from "./common/filter";
import { AuthController } from "./modules/auth";
import { BillingService } from "./modules/billing";
import { CatalogController } from "./modules/catalog";
import { EventsController, EventsService } from "./modules/events";
import { HomeController } from "./modules/home";
import { InvoicesController } from "./modules/invoices";
import { OutboxWorker } from "./modules/mail";
import { PdfService } from "./modules/pdf";
import { PublicController } from "./modules/public";
import { SettingsController } from "./modules/settings";
import { TimeController } from "./modules/time";
import { PrismaService } from "./prisma.service";

@Module({
  controllers: [
    AuthController,
    CatalogController,
    TimeController,
    HomeController,
    InvoicesController,
    PublicController,
    SettingsController,
    EventsController,
  ],
  providers: [
    PrismaService,
    BillingService,
    EventsService,
    PdfService,
    OutboxWorker,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
