import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({
  name: 'ContainsAtLeastOneUpperCaseLetter',
  async: false,
})
export class ContainsAtLeastOneUpperCaseLetter
  implements ValidatorConstraintInterface
{
  validate(text: string) {
    return /[A-Z]/.test(text);
  }

  defaultMessage() {
    return `Password must contain at least one uppercase letter`;
  }
}
