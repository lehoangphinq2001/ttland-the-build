import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({
  name: 'ContainsAtLeastOneLowerCaseLetter',
  async: false,
})
export class ContainsAtLeastOneLowerCaseLetter
  implements ValidatorConstraintInterface
{
  validate(text: string) {
    return /[a-z]/.test(text);
  }

  defaultMessage() {
    return `Password must contain at least one lowercase letter`;
  }
}
