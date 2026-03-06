import { ApiProperty, ApiTags } from "@nestjs/swagger";

export class SearchTextLocationNewDto {

    @ApiProperty()
    readonly stringSearch: string;
}
