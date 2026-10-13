# Crit 9 reflection

## What was the breakthrough that moved the work forward?

Once real-time worked, I stopped and asked what the main interaction actually
was.

The game was one decision deep. You made a claim, but nothing showed you what
that did to strangers on the board. The +1/−1 floats and the “whom you lifted”
message came out of that question. They gave the decision a consequence you
could see.

That also made an earlier technical choice feel more meaningful: sending the
whole board in every event. With the previous board and the next one, the page
could work out what changed and show who was affected.

## What did this work change about who I want to be as a software developer?

The other thing I’m taking from this week is how much I want to trust what I
can see.

The +1 float went out with no CSS while every test passed. The screenshot tool
switched the phone into mouse mode while capturing it, changing the thing I
thought I was checking. And the “9” turned into a blob—something I only caught
on the live board.

Three different ways to get a reassuring result without actually knowing
whether the experience worked.

I want to get better at staying curious after the tools say I’m done. Looking
at the actual thing. Asking what the check proves, and what it can’t see.
Making sure the interaction carries the meaning I intended.

That means breaking a test on purpose and watching it fail. It means checking
the worst case before calling something done.
