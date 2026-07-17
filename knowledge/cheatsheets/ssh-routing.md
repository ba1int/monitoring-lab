# SSH routing in the lab

Every mock host alias routes through `lab-bastion`.

```bash
ssh -G lab-prod-app01 | grep -E '^(user|hostname|port|proxyjump) '
ssh lab-prod-app01
```

The disposable identity and generated SSH config live only in the isolated
workstation home volume.
